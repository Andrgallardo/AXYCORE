import React, { useEffect, useMemo, useState } from 'react';
import { Download, Eye, FileCheck2, FolderOpen, Upload } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { ConfidentialDocPreviewModal } from '../components/ConfidentialDocPreviewModal';
import {
  generateId,
  recordConfidentialDocumentAccess,
  updateDocumentReviewStatus,
  uploadDocumentRecord,
} from '../services/axycoreStore';
import { formatTimestamp } from '../utils/formatters';
import type { ApplicationDocumentRecord } from '../types/axycore';

const CATEGORIES = [
  'CEDULA_IDENTIDAD',
  'COMPROBANTE_INGRESOS',
  'ESTADO_CUENTA',
  'COMPROBANTE_DOMICILIO',
  'DOCUMENTO_SOCIETARIO',
  'CONTRATO_FIRMADO',
  'PAGARE_FIRMADO',
  'OTRO_SOPORTE',
];

export function DocumentsView() {
  const {
    applications,
    documents,
    userProfile,
    selectedApplicationId,
    setSelectedApplicationId,
    rbac,
  } = useAxyCore();
  const canVerifyDocs = rbac.hasPermission('VERIFY_DOCUMENTS');
  const canUploadDocs = Boolean(userProfile) && !rbac.isReadOnlyAuditor;

  const [filterAppId, setFilterAppId] = useState(selectedApplicationId || 'ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');

  const [uploadAppId, setUploadAppId] = useState(selectedApplicationId || '');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [notes, setNotes] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [previewDoc, setPreviewDoc] = useState<ApplicationDocumentRecord | null>(null);

  useEffect(() => {
    if (selectedApplicationId) {
      setUploadAppId(selectedApplicationId);
      setFilterAppId(selectedApplicationId);
    }
  }, [selectedApplicationId]);

  const appMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of applications) {
      m.set(a.id, `${a.applicationNumber} · ${a.applicantDisplayName}`);
    }
    return m;
  }, [applications]);

  const filteredDocs = useMemo(() => {
    return documents.filter((d) => {
      if (filterAppId !== 'ALL' && d.applicationId !== filterAppId) return false;
      if (filterStatus !== 'ALL' && d.reviewStatus !== filterStatus) return false;
      return true;
    });
  }, [documents, filterAppId, filterStatus]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    const targetAppId = uploadAppId || applications[0]?.id;
    if (!targetAppId) {
      setFeedback({ type: 'err', msg: 'Debe existir al menos una solicitud para adjuntar documentos.' });
      return;
    }
    if (!selectedFile) {
      setFeedback({ type: 'err', msg: 'Seleccione un archivo para cargar al expediente.' });
      return;
    }
    if (selectedFile.size > 480000) {
      setFeedback({
        type: 'err',
        msg: 'El archivo excede 480 KB permitidos para almacenamiento directo en expediente.',
      });
      return;
    }

    setUploading(true);
    setFeedback(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
        reader.readAsDataURL(selectedFile);
      });

      await uploadDocumentRecord(
        {
          id: generateId('doc'),
          organizationId: userProfile.organizationId,
          applicationId: targetAppId,
          category,
          fileName: selectedFile.name,
          mimeType: selectedFile.type || 'application/octet-stream',
          sizeBytes: selectedFile.size,
          fileDataUrl: dataUrl,
          reviewStatus: 'RECIBIDO',
          notes: notes.trim(),
          uploadedBy: userProfile.uid,
          uploadedByName: userProfile.displayName,
        },
        userProfile
      );

      setFeedback({
        type: 'ok',
        msg: `Documento "${selectedFile.name}" cargado al expediente digital.`,
      });
      setSelectedFile(null);
      setNotes('');
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error cargando documento.',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleReviewChange = async (
    docItem: ApplicationDocumentRecord,
    nextStatus: ApplicationDocumentRecord['reviewStatus']
  ) => {
    if (!userProfile || !canVerifyDocs) return;
    try {
      await updateDocumentReviewStatus({
        docId: docItem.id,
        reviewStatus: nextStatus,
        notes: docItem.notes || `Revisado por ${userProfile.displayName}`,
        reviewerId: userProfile.uid,
        user: userProfile,
        organizationId: docItem.organizationId,
        previousStatus: docItem.reviewStatus,
        fileName: docItem.fileName,
        category: docItem.category,
        applicationId: docItem.applicationId,
      });
      setFeedback({
        type: 'ok',
        msg: `Estado del documento ${docItem.fileName} actualizado a ${nextStatus}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'No se pudo actualizar el estado del documento.',
      });
    }
  };

  const handlePreviewConfidentialDoc = (docItem: ApplicationDocumentRecord) => {
    setPreviewDoc(docItem);
    if (userProfile) {
      const appNumber = appMap.get(docItem.applicationId)?.split(' · ')[0];
      void recordConfidentialDocumentAccess({
        document: docItem,
        accessType: 'PREVIEW',
        user: userProfile,
        applicationNumber: appNumber,
      }).catch(() => {});
    }
  };

  const handleDownloadConfidentialDoc = (docItem: ApplicationDocumentRecord) => {
    if (!docItem.fileDataUrl) return;
    if (userProfile) {
      const appNumber = appMap.get(docItem.applicationId)?.split(' · ')[0];
      void recordConfidentialDocumentAccess({
        document: docItem,
        accessType: 'DOWNLOAD',
        user: userProfile,
        applicationNumber: appNumber,
      }).catch(() => {});
    }
    const link = document.createElement('a');
    link.href = docItem.fileDataUrl;
    link.download = docItem.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
          Expedientes Digitales y Verificación Documental
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Carga, clasificación y revisión de documentos vinculados a cada solicitud sin eliminación física.
        </p>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* Upload Box */}
      {canUploadDocs && (
      <form
        onSubmit={handleUpload}
        className="axy-surface p-5 rounded-2xl space-y-4 text-xs"
      >
        <h3 className="font-display text-sm font-bold flex items-center gap-2 text-slate-900 dark:text-white">
          <Upload className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
          Cargar Nuevo Documento a Expediente
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block mb-1 text-slate-500 dark:text-slate-400">Solicitud *</label>
            <select
              value={uploadAppId || applications[0]?.id || ''}
              onChange={(e) => setUploadAppId(e.target.value)}
              className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white"
            >
              {applications.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.applicationNumber} · {a.applicantDisplayName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block mb-1 text-slate-500 dark:text-slate-400">Categoría Documental</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block mb-1 text-slate-500 dark:text-slate-400">Archivo (PDF / PNG / JPG ≤ 480 KB)</label>
            <input
              type="file"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="axy-input w-full px-2 py-1.5 text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block mb-1 text-slate-500 dark:text-slate-400">Notas</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. Cédula vigente ambos lados"
              className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={uploading || applications.length === 0}
            className="axy-btn-primary inline-flex items-center gap-2 px-4 py-2 cursor-pointer disabled:opacity-50"
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            {uploading ? 'Subiendo...' : 'Adjuntar al Expediente'}
          </button>
        </div>
      </form>
      )}

      {/* Filters & Document Table */}
      <div className="axy-surface rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200/80 dark:border-[#00B8FF]/15 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="font-display text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-white">
            <FolderOpen className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
            Documentos Registrados ({filteredDocs.length})
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterAppId}
              onChange={(e) => setFilterAppId(e.target.value)}
              className="axy-input px-2.5 py-1.5 text-slate-900 dark:text-white"
            >
              <option value="ALL">Todas las solicitudes</option>
              {applications.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.applicationNumber}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="axy-input px-2.5 py-1.5 text-slate-900 dark:text-white"
            >
              <option value="ALL">Todos los estados</option>
              <option value="PENDIENTE">PENDIENTE</option>
              <option value="RECIBIDO">RECIBIDO</option>
              <option value="VERIFICADO">VERIFICADO</option>
              <option value="OBSERVADO">OBSERVADO</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="axy-table-head">
              <tr className="text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4 font-semibold">Archivo</th>
                <th className="py-2.5 px-4 font-semibold">Expediente</th>
                <th className="py-2.5 px-4 font-semibold">Categoría</th>
                <th className="py-2.5 px-4 font-semibold">Cargado por</th>
                <th className="py-2.5 px-4 font-semibold">Estado Revisión</th>
                <th className="py-2.5 px-4 text-right font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No hay documentos que coincidan con el filtro.
                  </td>
                </tr>
              ) : (
                filteredDocs.map((d) => (
                  <tr key={d.id} className="axy-table-row">
                    <td className="py-2.5 px-4">
                      <p className="font-semibold text-slate-900 dark:text-white">{d.fileName}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{d.notes || 'Sin notas'}</p>
                    </td>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => setSelectedApplicationId(d.applicationId)}
                        className="text-[#0066FF] dark:text-[#00D1FF] hover:underline cursor-pointer text-left font-medium"
                      >
                        {appMap.get(d.applicationId) || d.applicationId}
                      </button>
                    </td>
                    <td className="py-2.5 px-4 font-mono">{d.category}</td>
                    <td className="py-2.5 px-4">
                      {d.uploadedByName || d.uploadedBy} · {formatTimestamp(d.uploadedAt)}
                    </td>
                    <td className="py-2.5 px-4 font-semibold">{d.reviewStatus}</td>
                    <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                      {d.fileDataUrl && (
                        <>
                          <button
                            type="button"
                            onClick={() => handlePreviewConfidentialDoc(d)}
                            className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-200 hover:text-[#0066FF] dark:hover:text-[#00D1FF] cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Ver</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadConfidentialDoc(d)}
                            className="inline-flex items-center gap-1 text-[#0066FF] dark:text-[#00D1FF] hover:underline cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Descargar</span>
                          </button>
                        </>
                      )}
                      {canVerifyDocs && (
                        <select
                          value={d.reviewStatus}
                          onChange={(e) =>
                            handleReviewChange(
                              d,
                              e.target.value as ApplicationDocumentRecord['reviewStatus']
                            )
                          }
                          className="axy-input px-2 py-1 text-slate-900 dark:text-white"
                        >
                          <option value="PENDIENTE">PENDIENTE</option>
                          <option value="RECIBIDO">RECIBIDO</option>
                          <option value="VERIFICADO">VERIFICADO</option>
                          <option value="OBSERVADO">OBSERVADO</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfidentialDocPreviewModal
        document={previewDoc}
        applicationLabel={previewDoc ? appMap.get(previewDoc.applicationId) : undefined}
        onClose={() => setPreviewDoc(null)}
        onDownload={handleDownloadConfidentialDoc}
      />
    </div>
  );
}
