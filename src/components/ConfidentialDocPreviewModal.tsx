import React from 'react';
import { Download, Eye, ShieldCheck, X } from 'lucide-react';
import type { ApplicationDocumentRecord } from '../types/axycore';

interface ConfidentialDocPreviewModalProps {
  document: ApplicationDocumentRecord | null;
  applicationLabel?: string;
  onClose: () => void;
  onDownload: (doc: ApplicationDocumentRecord) => void;
}

export function ConfidentialDocPreviewModal({
  document,
  applicationLabel,
  onClose,
  onDownload,
}: ConfidentialDocPreviewModalProps) {
  if (!document || !document.fileDataUrl) return null;

  const mime = String(document.mimeType || '').toLowerCase();
  const isImage =
    mime.startsWith('image/') || document.fileDataUrl.startsWith('data:image/');
  const isPdf =
    mime === 'application/pdf' || document.fileDataUrl.startsWith('data:application/pdf');

  return (
    <div className="fixed inset-0 z-50 bg-[#030816]/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[90vh] axy-surface rounded-2xl flex flex-col overflow-hidden axy-panel-in">
        <div className="axy-infinity-line h-0.5 w-full shrink-0" />
        <div className="px-5 py-3.5 border-b border-[var(--axy-border)] flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[#0066FF] dark:text-[#00D1FF] font-medium">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Acceso auditado a documento confidencial (Ley 172-13)</span>
            </div>
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white truncate mt-0.5">
              [{document.category}] {document.fileName}
            </h3>
            {applicationLabel && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Expediente: {applicationLabel} · Estado: {document.reviewStatus}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDownload(document)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 axy-btn-primary text-xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Descargar
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 axy-btn-secondary text-slate-600 dark:text-slate-300 cursor-pointer"
              aria-label="Cerrar vista previa"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto axy-surface-tonal border-0 p-4 flex items-center justify-center min-h-[360px]">
          {isImage ? (
            <img
              src={document.fileDataUrl}
              alt={document.fileName}
              className="max-w-full max-h-[70vh] object-contain rounded-xl border border-[var(--axy-border)] bg-white"
            />
          ) : isPdf ? (
            <object
              data={document.fileDataUrl}
              type="application/pdf"
              className="w-full h-[70vh] rounded-xl border border-[var(--axy-border)] bg-white"
            >
              <div className="p-6 text-center text-xs text-slate-500 space-y-2">
                <Eye className="w-6 h-6 mx-auto text-slate-400" />
                <p>El visor PDF integrado no está disponible en este navegador.</p>
                <button
                  type="button"
                  onClick={() => onDownload(document)}
                  className="px-3 py-1.5 axy-btn-primary text-xs cursor-pointer"
                >
                  Descargar archivo PDF
                </button>
              </div>
            </object>
          ) : (
            <div className="p-6 text-center text-xs text-slate-500 space-y-3">
              <p>
                Vista previa en línea no disponible para el tipo <span className="font-mono">{document.mimeType || 'archivo binario'}</span>.
              </p>
              <button
                type="button"
                onClick={() => onDownload(document)}
                className="inline-flex items-center gap-1.5 px-4 py-2 axy-btn-primary text-xs cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Descargar copia auditada
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
