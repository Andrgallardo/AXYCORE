import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileCode2,
  FileInput,
  ShieldAlert,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Upload,
} from 'lucide-react';
import { useAxyCore } from '../../../context/AxyCoreContext';
import { buildDgiiAcecfXml, buildDgiiArecfXml, type ParsedSupplierEcf } from '../../../engine/dgii/dgiiXmlEngine';
import { generateId } from '../../../services/axycoreStore';
import {
  logDgiiCustomAuditEvent,
  recordReceivedSupplierEcf,
  settleEcfPaymentAndPostAccounting,
} from '../../../services/dgiiEcfStore';
import { ECF_STATUS_LABELS, ECF_TYPE_META, type DgiiEcfDocumentRecord } from '../../../types/dgiiEcf';
import { formatMoney } from '../../../utils/formatters';

interface VerificationPayload {
  parsed: ParsedSupplierEcf;
  structural: { valid: boolean; errors: string[]; checksExecuted: string[] };
  signature: { hasSignature: boolean; validSignature: boolean; error?: string };
}

function downloadXml(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/xml;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DgiiReceivedEcfView() {
  const {
    organization,
    userProfile,
    rbac,
    activeDgiiConfig,
    dgiiCertificates,
    dgiiEcfDocuments,
    accountingAccounts,
  } = useAxyCore();

  const canValidate = rbac.hasPermission('VALIDATE_RECEIVED_ECF');
  const activeCert = useMemo(
    () => dgiiCertificates.find((c) => c.status === 'ACTIVO' || c.status === 'POR_VENCER') ?? null,
    [dgiiCertificates]
  );

  const receivedDocs = useMemo(
    () =>
      dgiiEcfDocuments
        .filter((d) => d.direction === 'RECIBIDO')
        .sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
    [dgiiEcfDocuments]
  );

  const [xmlInput, setXmlInput] = useState('');
  const [verification, setVerification] = useState<VerificationPayload | null>(null);
  const [approvalReason, setApprovalReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [generatedArecf, setGeneratedArecf] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setXmlInput(text);
    setVerification(null);
  };

  const handleVerifyXml = async () => {
    if (!xmlInput.trim()) {
      setFeedback({ kind: 'err', text: 'Cargue o pegue el XML del proveedor antes de validar.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/dgii/xml/verify-supplier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml: xmlInput }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Error analizando XML del proveedor.');
      }
      setVerification({
        parsed: json.parsed,
        structural: json.structural,
        signature: json.signature,
      });
      const arecf = buildDgiiArecfXml({
        issuerRnc: json.parsed.issuerRnc,
        buyerRnc: activeDgiiConfig.rnc || json.parsed.buyerRnc,
        eNCF: json.parsed.eNCF,
        accepted: Boolean(json.structural?.valid),
        errorCode: json.structural?.valid ? undefined : '1',
      });
      setGeneratedArecf(arecf);
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'No se pudo verificar el XML recibido.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterAndApprove = async (decision: '1' | '2') => {
    if (!verification || !userProfile || !canValidate) return;
    if (decision === '2' && !approvalReason.trim()) {
      setFeedback({ kind: 'err', text: 'Indique el motivo de rechazo comercial del e-CF.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const p = verification.parsed;
      const docId = generateId('ecfrec');
      const items = p.items.map((it, idx) => ({
        lineNumber: idx + 1,
        description: it.description,
        itemType: 'SERVICIO' as const,
        quantity: it.quantity,
        unitOfMeasure: 'UND',
        unitPrice: it.unitPrice,
        discountAmount: 0,
        itbisRate: (it.itbisAmount > 0 ? 18 : 0) as 18 | 16 | 0,
        isExempt: it.itbisAmount <= 0,
        itbisAmount: it.itbisAmount,
        otherTaxCode: 'NINGUNO' as const,
        otherTaxRatePct: 0,
        otherTaxAmount: 0,
        lineSubtotal: it.lineSubtotal,
        lineTotal: it.lineSubtotal + it.itbisAmount,
      }));

      const acecfXml = buildDgiiAcecfXml({
        issuerRnc: p.issuerRnc,
        eNCF: p.eNCF,
        issueDate: p.issueDateIso,
        totalAmount: p.totalAmount,
        buyerRnc: activeDgiiConfig.rnc || p.buyerRnc,
        status: decision,
        reason: decision === '2' ? approvalReason.trim() : undefined,
      });

      let signedAcecfXml = acecfXml;
      let isOfficialDgii = false;

      if (activeCert && activeDgiiConfig.environment !== 'DESARROLLO') {
        const res = await fetch('/api/dgii/ecf/commercial-approval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organizationId: organization.id,
            environment: activeDgiiConfig.environment,
            endpoints: activeDgiiConfig.endpointsByEnv[activeDgiiConfig.environment],
            vaultKeyId: activeCert.vaultKeyId,
            xml: acecfXml,
            fileName: `${activeDgiiConfig.rnc}${p.eNCF}_ACECF.xml`,
            timeoutMs: activeDgiiConfig.timeoutMs,
            maxRetries: activeDgiiConfig.maxRetries,
          }),
        });
        const json = await res.json();
        if (res.ok && json.ok) {
          signedAcecfXml = json.signedXml || acecfXml;
          isOfficialDgii = Boolean(json.dgiiResult?.isOfficialDgiiResponse);
        }
      }

      const recDoc: Omit<DgiiEcfDocumentRecord, 'createdAt' | 'updatedAt'> = {
        id: docId,
        organizationId: organization.id,
        direction: 'RECIBIDO',
        ecfType: p.ecfType,
        eNCF: p.eNCF,
        status: decision === '1' ? 'ACEPTADA' : 'RECHAZADA',
        environment: activeDgiiConfig.environment,
        isOfficialDgiiResponse: isOfficialDgii,
        isTestSimulation: activeDgiiConfig.environment === 'DESARROLLO',
        issuerRnc: p.issuerRnc,
        issuerName: p.issuerName,
        issuerAddress: p.issuerAddress,
        receiverIdType: 'RNC',
        receiverTaxId: activeDgiiConfig.rnc || p.buyerRnc,
        receiverName: activeDgiiConfig.legalName,
        receiverAddress: activeDgiiConfig.fiscalAddress || 'República Dominicana',
        issueDate: p.issueDateIso,
        paymentCondition: 'CREDITO_30',
        paymentMethod: 'VENTA_CREDITO',
        currency: p.currency,
        exchangeRate: 1,
        items,
        subtotal: p.taxableAmount + p.exemptAmount,
        totalDiscount: 0,
        exemptAmount: p.exemptAmount,
        taxableAmount18: p.taxableAmount,
        taxableAmount16: 0,
        totalItbis: p.totalItbis,
        otherTaxesTotal: 0,
        totalAmount: p.totalAmount,
        originalXml: xmlInput,
        signedXml: xmlInput,
        securityCode: p.securityCode,
        dgiiResponses: [],
        commercialApprovalStatus: decision === '1' ? 'ACEPTADA' : 'RECHAZADA',
        acuseReciboXml: generatedArecf,
        aprobacionComercialXml: signedAcecfXml,
        paymentCollectionStatus: decision === '1' ? 'PENDIENTE' : 'NO_APLICA',
        createdBy: userProfile.uid,
        createdByName: userProfile.displayName,
      };

      const saved = await recordReceivedSupplierEcf({
        document: recDoc,
        config: activeDgiiConfig,
        accounts: accountingAccounts,
        user: userProfile,
      });

      await logDgiiCustomAuditEvent({
        organizationId: organization.id,
        eventType: 'COMMERCIAL_APPROVAL',
        ecfDocumentId: saved.document.id,
        eNCF: saved.document.eNCF,
        environment: activeDgiiConfig.environment,
        summary: `Aprobación comercial ACECF (${decision === '1' ? 'ACEPTADA' : 'RECHAZADA'}) para ${saved.document.eNCF} de ${saved.document.issuerName}.`,
        user: userProfile,
      });

      setFeedback({
        kind: 'ok',
        text: `e-CF ${p.eNCF} registrado (${decision === '1' ? 'Aprobado' : 'Rechazado'}) · ${
          saved.journalEntry ? `Asiento CxP ${saved.journalEntry.entryNumber} contabilizado.` : 'Sin asiento.'
        }`,
      });
      setXmlInput('');
      setVerification(null);
      setApprovalReason('');
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Error registrando e-CF recibido.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePaySupplier = async (docRec: DgiiEcfDocumentRecord) => {
    if (!userProfile || !canValidate) return;
    setBusy(true);
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
        text: `Pago a suplidor registrado para ${docRec.eNCF}. Asiento ${je.entryNumber} contabilizado.`,
      });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Error liquidando CxP de proveedor.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="space-y-1">
        <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
          <FileInput className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
          <span>Facturas Recibidas de Proveedores (ARECF / ACECF / 606)</span>
        </h2>
        <p className="text-slate-500 dark:text-slate-400">
          Importe el XML de comprobantes electrónicos emitidos por suplidores, verifique su firma digital y estructura
          DGII, emita Acuse de Recibo (ARECF) / Aprobación Comercial (ACECF) y registre automáticamente CxP e ITBIS 606.
        </p>
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

      {/* Upload & Verify Panel */}
      <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-semibold text-slate-950 dark:text-white flex items-center gap-2">
            <FileCode2 className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
            <span>Validar XML Recibido del Suplidor</span>
          </span>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/15 font-semibold cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5">
            <Upload className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
            <span>Cargar Archivo .XML</span>
            <input type="file" accept=".xml,text/xml" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>

        <textarea
          rows={6}
          value={xmlInput}
          onChange={(e) => setXmlInput(e.target.value)}
          placeholder="Pegue aquí el contenido completo del archivo XML (<ECF>...</ECF>) recibido del proveedor..."
          className="w-full p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono text-[11px]"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            disabled={busy || !xmlInput.trim()}
            onClick={handleVerifyXml}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{busy ? 'Analizando XML...' : 'Verificar Estructura XSD y Firma XMLDSig'}</span>
          </button>
          {generatedArecf && verification && (
            <button
              type="button"
              onClick={() => downloadXml(`ARECF_${verification.parsed.eNCF}.xml`, generatedArecf)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/15 font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar Acuse ARECF</span>
            </button>
          )}
        </div>

        {verification && (
          <div className="mt-3 p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/15 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <span className="text-slate-500">Suplidor Emisor:</span>
                <p className="font-bold text-slate-950 dark:text-white">{verification.parsed.issuerName}</p>
                <p className="font-mono">RNC: {verification.parsed.issuerRnc}</p>
              </div>
              <div>
                <span className="text-slate-500">Comprobante:</span>
                <p className="font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">
                  {verification.parsed.eNCF} ({ECF_TYPE_META[verification.parsed.ecfType].shortName})
                </p>
                <p className="font-mono">Fecha: {verification.parsed.issueDateIso}</p>
              </div>
              <div>
                <span className="text-slate-500">Totales Fiscales:</span>
                <p className="font-mono font-bold">
                  Total: {formatMoney(verification.parsed.totalAmount, verification.parsed.currency)}
                </p>
                <p className="font-mono">
                  ITBIS: {formatMoney(verification.parsed.totalItbis, verification.parsed.currency)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold ${
                  verification.structural.valid
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300'
                }`}
              >
                {verification.structural.valid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                <span>Estructura XSD: {verification.structural.valid ? 'Válida' : 'Con Errores'}</span>
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold ${
                  verification.signature.validSignature
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
                }`}
              >
                <span>
                  Firma XMLDSig: {verification.signature.validSignature ? 'Válida y Verificada' : verification.signature.error || 'No verificada'}
                </span>
              </span>
            </div>

            {canValidate && (
              <div className="pt-2 border-t border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
                <input
                  type="text"
                  value={approvalReason}
                  onChange={(e) => setApprovalReason(e.target.value)}
                  placeholder="Motivo de rechazo comercial (solo si rechaza ACECF)..."
                  className="flex-1 min-w-[220px] px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#08132B]"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRegisterAndApprove('1')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer disabled:opacity-50"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>Aprobar ACECF y Contabilizar CxP</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRegisterAndApprove('2')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold cursor-pointer disabled:opacity-50"
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                    <span>Rechazar ACECF</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Received Supplier Invoices Table */}
      <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <span className="font-semibold text-slate-950 dark:text-white">Comprobantes Recibidos de Proveedores</span>
          <span className="font-mono text-[11px] text-slate-500">{receivedDocs.length} documentos</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase text-slate-500">
                <th className="py-2.5 px-3">Fecha</th>
                <th className="py-2.5 px-3">Proveedor</th>
                <th className="py-2.5 px-3">RNC Emisor</th>
                <th className="py-2.5 px-3">e-NCF</th>
                <th className="py-2.5 px-3 text-right">ITBIS</th>
                <th className="py-2.5 px-3 text-right">Total</th>
                <th className="py-2.5 px-3">ACECF</th>
                <th className="py-2.5 px-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {receivedDocs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    No hay facturas electrónicas recibidas registradas todavía.
                  </td>
                </tr>
              ) : (
                receivedDocs.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100 dark:border-white/5">
                    <td className="py-2.5 px-3 font-mono">{d.issueDate}</td>
                    <td className="py-2.5 px-3 font-semibold">{d.issuerName}</td>
                    <td className="py-2.5 px-3 font-mono">{d.issuerRnc}</td>
                    <td className="py-2.5 px-3 font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">{d.eNCF}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatMoney(d.totalItbis, d.currency)}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold">
                      {formatMoney(d.totalAmount, d.currency)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-white/10">
                        {ECF_STATUS_LABELS[d.status]} · {d.paymentCollectionStatus}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {d.aprobacionComercialXml && (
                          <button
                            type="button"
                            onClick={() => downloadXml(`ACECF_${d.eNCF}.xml`, d.aprobacionComercialXml!)}
                            className="px-2 py-1 rounded-lg border border-slate-200 dark:border-white/10 text-[10px] font-semibold cursor-pointer"
                          >
                            ACECF
                          </button>
                        )}
                        {canValidate && d.paymentCollectionStatus === 'PENDIENTE' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handlePaySupplier(d)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-semibold cursor-pointer disabled:opacity-50"
                          >
                            Registrar Pago CxP
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
