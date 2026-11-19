import React from 'react';
import { Download, Eye, FileText, X } from 'lucide-react';
import type { PaymentRecord } from '../types/collections';
import { formatMoney } from '../utils/formatters';
import { downloadPaymentEvidence, formatEvidenceFileSize } from '../utils/paymentEvidence';

interface PaymentEvidencePreviewModalProps {
  payment: PaymentRecord | null;
  onClose: () => void;
}

export function PaymentEvidencePreviewModal({
  payment,
  onClose,
}: PaymentEvidencePreviewModalProps) {
  if (!payment || !payment.receiptEvidenceDataUrl) return null;

  const mime = String(payment.receiptEvidenceMimeType || '').toLowerCase();
  const isImage =
    mime.startsWith('image/') || payment.receiptEvidenceDataUrl.startsWith('data:image/');
  const isPdf =
    mime === 'application/pdf' || payment.receiptEvidenceDataUrl.startsWith('data:application/pdf');

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/25 rounded-2xl flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[#00B8FF]/15 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-[#0052CC] dark:text-[#00D1FF] font-semibold">
              <FileText className="w-4 h-4 shrink-0" />
              <span>Comprobante de Pago Adjunto</span>
            </div>
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white truncate mt-0.5">
              {payment.customerName} · {payment.loanNumber} ·{' '}
              {formatMoney(payment.amount, payment.currency)}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              Archivo: {payment.receiptEvidenceName || 'Comprobante'}
              {payment.receiptEvidenceSizeBytes
                ? ` (${formatEvidenceFileSize(payment.receiptEvidenceSizeBytes)})`
                : ''}{' '}
              · Ref: {payment.referenceNumber} · Fecha: {payment.paymentDate}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => downloadPaymentEvidence(payment)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-[#00B8FF]/25 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer"
              aria-label="Cerrar vista previa"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-slate-100 dark:bg-[#040C1E] p-4 flex items-center justify-center min-h-[360px]">
          {isImage ? (
            <img
              src={payment.receiptEvidenceDataUrl}
              alt={payment.receiptEvidenceName || 'Comprobante de pago'}
              className="max-w-full max-h-[70vh] object-contain rounded-lg border border-slate-200 dark:border-[#00B8FF]/20 bg-white"
            />
          ) : isPdf ? (
            <object
              data={payment.receiptEvidenceDataUrl}
              type="application/pdf"
              className="w-full h-[70vh] rounded-lg border border-slate-200 dark:border-[#00B8FF]/20 bg-white"
            >
              <div className="p-6 text-center text-xs text-slate-500 space-y-2">
                <Eye className="w-6 h-6 mx-auto text-slate-400" />
                <p>El visor PDF integrado no está disponible en este navegador.</p>
                <button
                  type="button"
                  onClick={() => downloadPaymentEvidence(payment)}
                  className="px-3 py-1.5 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer"
                >
                  Descargar comprobante PDF
                </button>
              </div>
            </object>
          ) : (
            <div className="p-6 text-center text-xs text-slate-500 space-y-3">
              <p>
                Vista previa no disponible para{' '}
                <span className="font-mono">{payment.receiptEvidenceMimeType || 'este archivo'}</span>.
              </p>
              <button
                type="button"
                onClick={() => downloadPaymentEvidence(payment)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Descargar comprobante</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
