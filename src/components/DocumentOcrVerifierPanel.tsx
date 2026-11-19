import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  Loader2,
  ScanText,
  Sparkles,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  applyOcrVerificationToDocument,
  generateId,
  recordConfidentialDocumentAccess,
  uploadDocumentRecord,
  verifyDocumentWithGeminiOcr,
} from '../services/axycoreStore';
import { isSupportedOcrMimeType, OCR_VERDICT_LABELS } from '../engine/documentOcr';
import type {
  ApplicationDocumentRecord,
  ApplicationRecord,
  BusinessRecord,
  CustomerRecord,
  DocumentOcrResult,
  UserProfile,
} from '../types/axycore';

interface DocumentOcrVerifierPanelProps {
  application: ApplicationRecord;
  customer: CustomerRecord | null;
  business: BusinessRecord | null;
  documents: ApplicationDocumentRecord[];
  canVerifyDocs: boolean;
  canEditAnalystSection: boolean;
  userProfile: UserProfile | null;
  isReadOnlyAuditor: boolean;
  onApplyExtractedFinancials: (params: {
    primaryNetIncome?: number | null;
    currentDebtPayments?: number | null;
    markIncomeVerified?: boolean;
    markIdentityVerified?: boolean;
    findingsSnippet?: string;
  }) => void;
}

const OCR_CATEGORIES = [
  { value: 'COMPROBANTE_INGRESOS', label: 'Comprobante de Ingresos / Nómina' },
  { value: 'ESTADO_CUENTA', label: 'Estado de Cuenta Bancario' },
  { value: 'CEDULA_IDENTIDAD', label: 'Cédula / Pasaporte' },
  { value: 'DOCUMENTO_SOCIETARIO', label: 'Documento Societario / RNC' },
  { value: 'COMPROBANTE_DOMICILIO', label: 'Comprobante de Domicilio' },
  { value: 'OTRO_SOPORTE', label: 'Otro Soporte Financiero' },
];

export function DocumentOcrVerifierPanel({
  application,
  customer,
  business,
  documents,
  canVerifyDocs,
  canEditAnalystSection,
  userProfile,
  isReadOnlyAuditor,
  onApplyExtractedFinancials,
}: DocumentOcrVerifierPanelProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('COMPROBANTE_INGRESOS');
  const [adHocFile, setAdHocFile] = useState<File | null>(null);
  const [attachOnScan, setAttachOnScan] = useState<boolean>(true);
  const [scanningDocId, setScanningDocId] = useState<string | null>(null);
  const [savingDocDecision, setSavingDocDecision] = useState(false);
  const [ocrResult, setOcrResult] = useState<DocumentOcrResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const canAttachDocument = Boolean(
    userProfile &&
      !isReadOnlyAuditor &&
      ['ADMIN', 'BUSINESS_OFFICER', 'EXTERNAL_CLIENT'].includes(userProfile.role)
  );

  const handleVerifyAttachedDoc = async (docItem: ApplicationDocumentRecord) => {
    if (!docItem.fileDataUrl) {
      setErrorMsg(
        `El registro "${docItem.fileName}" solo contiene metadatos sin archivo adjunto. Sube la imagen o PDF abajo para validarlo con Gemini OCR.`
      );
      return;
    }
    setScanningDocId(docItem.id);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      if (userProfile) {
        void recordConfidentialDocumentAccess({
          document: docItem,
          accessType: 'OCR_SCAN',
          user: userProfile,
          applicationNumber: application.applicationNumber,
        }).catch(() => {});
      }
      const result = await verifyDocumentWithGeminiOcr({
        document: {
          id: docItem.id,
          category: docItem.category,
          fileName: docItem.fileName,
          mimeType: docItem.mimeType,
          fileDataUrl: docItem.fileDataUrl,
        },
        application,
        customer,
        business,
      });
      setOcrResult(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo completar el análisis OCR.');
    } finally {
      setScanningDocId(null);
    }
  };

  const handleScanUploadedFile = async () => {
    if (!adHocFile) {
      setErrorMsg('Selecciona un archivo (PNG, JPG, WEBP o PDF) para ejecutar el OCR.');
      return;
    }
    if (!isSupportedOcrMimeType(adHocFile.type)) {
      setErrorMsg(
        `Formato no compatible (${adHocFile.type || 'desconocido'}). Adjunta PNG, JPG, WEBP o PDF.`
      );
      return;
    }
    if (adHocFile.size > 1500000) {
      setErrorMsg('El archivo excede 1.5 MB para análisis OCR directo.');
      return;
    }

    setScanningDocId('__adhoc__');
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
        reader.readAsDataURL(adHocFile);
      });

      let savedDocId: string | undefined;
      if (attachOnScan && canAttachDocument && userProfile) {
        if (adHocFile.size > 480000) {
          setInfoMsg(
            'Archivo analizado por OCR sin adjuntarse en Firestore porque supera 480 KB de almacenamiento directo en expediente.'
          );
        } else {
          savedDocId = generateId('doc');
          await uploadDocumentRecord(
            {
              id: savedDocId,
              organizationId: application.organizationId,
              applicationId: application.id,
              category: selectedCategory,
              fileName: adHocFile.name,
              mimeType: adHocFile.type || 'application/octet-stream',
              sizeBytes: adHocFile.size,
              fileDataUrl: dataUrl,
              reviewStatus: 'RECIBIDO',
              notes: 'Cargado para verificación OCR automática',
              uploadedBy: userProfile.uid,
              uploadedByName: userProfile.displayName,
            },
            userProfile
          );
        }
      }

      const result = await verifyDocumentWithGeminiOcr({
        document: {
          id: savedDocId,
          category: selectedCategory,
          fileName: adHocFile.name,
          mimeType: adHocFile.type,
          fileDataUrl: dataUrl,
        },
        application,
        customer,
        business,
      });

      setOcrResult(result);
      setAdHocFile(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error analizando el documento con Gemini.');
    } finally {
      setScanningDocId(null);
    }
  };

  const handlePersistDocumentDecision = async (status: 'VERIFICADO' | 'OBSERVADO') => {
    if (!ocrResult?.documentId || !userProfile) return;
    const docRecord = documents.find((d) => d.id === ocrResult.documentId);
    if (!docRecord) {
      setErrorMsg('No se encontró el documento en la lista actual del expediente.');
      return;
    }

    setSavingDocDecision(true);
    setErrorMsg(null);
    try {
      await applyOcrVerificationToDocument({
        docRecord,
        ocrResult,
        overrideStatus: status,
        user: userProfile,
      });
      setInfoMsg(
        `Documento "${docRecord.fileName}" marcado como ${status} con el resumen OCR guardado en auditoría.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error guardando dictamen OCR.');
    } finally {
      setSavingDocDecision(false);
    }
  };

  const verdictStyle =
    ocrResult?.overallVerdict === 'COINCIDE'
      ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
      : ocrResult?.overallVerdict === 'DISCREPANCIA_MENOR'
      ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
      : 'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200';

  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ScanText className="w-4 h-4 text-sky-700 dark:text-sky-400" />
            <span>Verificador Automático de Documentos (Gemini OCR)</span>
          </h4>
          <p className="text-slate-500 dark:text-slate-400">
            Extrae cifras e identidad desde comprobantes de ingresos, estados de cuenta o cédulas y las contrasta con la solicitud {application.applicationNumber}.
          </p>
        </div>
        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
          Motor: gemini-4-hydrogen
        </span>
      </div>

      {/* Existing attached documents quick OCR trigger */}
      {documents.length > 0 && (
        <div className="space-y-2">
          <p className="font-semibold text-slate-700 dark:text-slate-300">
            Soportes adjuntos en el expediente ({documents.length})
          </p>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            {documents.map((docItem) => {
              const isScanning = scanningDocId === docItem.id;
              return (
                <div
                  key={docItem.id}
                  className="p-2.5 bg-slate-50/60 dark:bg-slate-800/30 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-mono font-medium text-slate-800 dark:text-slate-200 truncate">
                      [{docItem.category}] {docItem.fileName}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      Estado actual: {docItem.reviewStatus}
                      {docItem.notes ? ` · ${docItem.notes}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={scanningDocId !== null || !docItem.fileDataUrl}
                    onClick={() => handleVerifyAttachedDoc(docItem)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-500 text-white font-medium whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    {isScanning ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Analizando OCR...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        {docItem.fileDataUrl ? 'Verificar con Gemini OCR' : 'Sin archivo adjunto'}
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Direct upload & OCR verification bar */}
      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
        <p className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          <Upload className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400" />
          <span>Escanear y validar un documento directamente (PNG, JPG, WEBP o PDF)</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
          <div className="sm:col-span-4">
            <label className="block text-[11px] text-slate-500 mb-1">Tipo de documento</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              {OCR_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-5">
            <label className="block text-[11px] text-slate-500 mb-1">
              Archivo comprobante (máx. 1.5 MB; ≤ 480 KB para guardar)
            </label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              onChange={(e) => setAdHocFile(e.target.files?.[0] || null)}
              className="w-full px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <button
              type="button"
              disabled={!adHocFile || scanningDocId !== null}
              onClick={handleScanUploadedFile}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {scanningDocId === '__adhoc__' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Extrayendo...
                </>
              ) : (
                <>
                  <FileSearch className="w-3.5 h-3.5" />
                  Validar con OCR
                </>
              )}
            </button>
          </div>
        </div>
        {canAttachDocument && (
          <label className="inline-flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={attachOnScan}
              onChange={(e) => setAttachOnScan(e.target.checked)}
            />
            <span>Adjuntar automáticamente este comprobante al expediente digital (si ≤ 480 KB)</span>
          </label>
        )}
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {errorMsg}
        </div>
      )}

      {infoMsg && (
        <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {infoMsg}
        </div>
      )}

      {/* OCR Cross-Check Result */}
      {ocrResult && (
        <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className={`p-4 rounded-xl border space-y-2 ${verdictStyle}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-display text-sm font-bold">
                {ocrResult.overallVerdict === 'COINCIDE' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : ocrResult.overallVerdict === 'DISCREPANCIA_MENOR' ? (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{OCR_VERDICT_LABELS[ocrResult.overallVerdict]}</span>
              </div>
              <div className="font-mono text-[11px] tabular-nums">
                Confianza OCR: <strong>{ocrResult.confidenceScore}%</strong> ·{' '}
                {ocrResult.detectedDocumentType}
              </div>
            </div>
            <p className="leading-relaxed">{ocrResult.summary}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono opacity-90 pt-1">
              <span>Archivo: {ocrResult.fileName}</span>
              {ocrResult.extractedFields.documentDate && (
                <span>Fecha doc.: {ocrResult.extractedFields.documentDate}</span>
              )}
              {ocrResult.extractedFields.currency && (
                <span>Moneda OCR: {ocrResult.extractedFields.currency}</span>
              )}
            </div>
          </div>

          {/* Field-by-field comparison table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                  <th className="py-2 px-3 font-semibold">Campo Evaluado</th>
                  <th className="py-2 px-3 font-semibold">Declarado en Solicitud</th>
                  <th className="py-2 px-3 font-semibold">Extraído por Gemini OCR</th>
                  <th className="py-2 px-3 font-semibold text-right">Var. %</th>
                  <th className="py-2 px-3 font-semibold">Validación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {ocrResult.comparisons.map((row) => {
                  const statusLabel =
                    row.matchStatus === 'MATCH'
                      ? 'Coincide'
                      : row.matchStatus === 'MINOR_DIFF'
                      ? 'Diferencia menor'
                      : row.matchStatus === 'MISMATCH'
                      ? 'Discrepancia'
                      : 'No detectado';
                  const statusColor =
                    row.matchStatus === 'MATCH'
                      ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                      : row.matchStatus === 'MINOR_DIFF'
                      ? 'text-amber-700 dark:text-amber-400 font-semibold'
                      : row.matchStatus === 'MISMATCH'
                      ? 'text-rose-700 dark:text-rose-400 font-semibold'
                      : 'text-slate-500 dark:text-slate-400';

                  return (
                    <tr key={row.fieldKey}>
                      <td className="py-2 px-3 font-medium text-slate-900 dark:text-white">
                        {row.fieldLabel}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">
                        {row.declaredValue}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-900 dark:text-white">
                        {row.extractedValue}
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums text-right">
                        {row.variancePct !== null ? `${row.variancePct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`block ${statusColor}`}>{statusLabel}</span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {row.detail}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {ocrResult.extractedFields.rawKeyLines.length > 0 && (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
              <p className="font-semibold text-[11px] text-slate-600 dark:text-slate-300 mb-1">
                Líneas clave extraídas por OCR
              </p>
              <ul className="space-y-0.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                {ocrResult.extractedFields.rawKeyLines.map((line, idx) => (
                  <li key={idx} className="truncate">
                    · {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              {canEditAnalystSection &&
                (ocrResult.suggestedVerifiedFinancials.primaryNetIncome !== null ||
                  ocrResult.suggestedVerifiedFinancials.currentDebtPayments !== null) && (
                  <button
                    type="button"
                    onClick={() => {
                      const idMatched = ocrResult.comparisons.some(
                        (c) =>
                          (c.fieldKey === 'holderName' || c.fieldKey === 'documentNumber') &&
                          c.matchStatus === 'MATCH'
                      );
                      const incomeMatched = ocrResult.comparisons.some(
                        (c) => c.fieldKey === 'monthlyIncome' && c.matchStatus === 'MATCH'
                      );
                      onApplyExtractedFinancials({
                        primaryNetIncome: ocrResult.suggestedVerifiedFinancials.primaryNetIncome,
                        currentDebtPayments:
                          ocrResult.suggestedVerifiedFinancials.currentDebtPayments,
                        markIncomeVerified: incomeMatched,
                        markIdentityVerified: idMatched,
                        findingsSnippet: `[Gemini OCR ${ocrResult.fileName}] ${ocrResult.summary}`,
                      });
                      setInfoMsg(
                        'Cifras extraídas aplicadas en "Datos Verificados por Analista". Recuerda recalcular el Motor V2.'
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-sky-600 text-white font-semibold cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Aplicar cifras OCR a Datos Verificados
                  </button>
                )}
            </div>

            {ocrResult.documentId && canVerifyDocs && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={savingDocDecision}
                  onClick={() => handlePersistDocumentDecision('VERIFICADO')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 font-semibold cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Marcar Documento VERIFICADO
                </button>
                <button
                  type="button"
                  disabled={savingDocDecision}
                  onClick={() => handlePersistDocumentDecision('OBSERVADO')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 font-semibold cursor-pointer disabled:opacity-50"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Marcar OBSERVADO
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
