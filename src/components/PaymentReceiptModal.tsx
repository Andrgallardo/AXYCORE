import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Calendar,
  Clock,
  Coins,
  CreditCard,
  Download,
  FileText,
  Image as ImageIcon,
  Printer,
  User,
  X,
} from 'lucide-react';
import type {
  CollectionReceiptRecord,
  CustomerRecord,
  LoanRecord,
  OrganizationRecord,
  PaymentRecord,
} from '../types/axycore';
import {
  buildPaymentReceiptViewData,
  downloadPaymentReceiptPdf,
  downloadPaymentReceiptPng,
  printPaymentReceipt,
} from '../utils/paymentReceiptGenerator';

export interface PaymentReceiptModalProps {
  receipt: CollectionReceiptRecord | null;
  organization: OrganizationRecord;
  payment?: PaymentRecord | null;
  loan?: LoanRecord | null;
  customer?: CustomerRecord | null;
  onClose: () => void;
}

export function PaymentReceiptModal({
  receipt,
  organization,
  payment,
  loan,
  customer,
  onClose,
}: PaymentReceiptModalProps) {
  const [busyAction, setBusyAction] = useState<'pdf' | 'png' | 'print' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  const viewData = useMemo(() => {
    if (!receipt) return null;
    return buildPaymentReceiptViewData({
      receipt,
      organization,
      payment,
      loan,
      customer,
    });
  }, [receipt, organization, payment, loan, customer]);

  useEffect(() => {
    setLogoFailed(false);
    setExportError(null);
  }, [receipt?.id, organization.logoUrl]);

  useEffect(() => {
    if (!receipt) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [receipt, onClose]);

  if (!receipt || !viewData) return null;

  const { palette } = viewData;
  const inputPayload = { receipt, organization, payment, loan, customer };

  const handleExportPdf = async () => {
    setBusyAction('pdf');
    setExportError(null);
    try {
      await downloadPaymentReceiptPdf(inputPayload);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'No se pudo generar el PDF del recibo.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportPng = async () => {
    setBusyAction('png');
    setExportError(null);
    try {
      await downloadPaymentReceiptPng(inputPayload);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'No se pudo generar la imagen del recibo.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handlePrint = async () => {
    setBusyAction('print');
    setExportError(null);
    try {
      await printPaymentReceipt(inputPayload);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'No se pudo iniciar la impresión.'
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`Recibo de Pago ${viewData.receiptNumber}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[740px] my-auto flex flex-col gap-3">
        {/* Top Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white dark:bg-[#0B1730] border border-slate-200 dark:border-white/10 px-4 py-3 shadow-xl">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
              Recibo de Pago · {viewData.receiptNumber}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {viewData.institutionName} · {viewData.customerName}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleExportPdf()}
              className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl bg-[#0052CC] hover:bg-[#003D99] text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{busyAction === 'pdf' ? 'Generando…' : 'Descargar PDF'}</span>
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handleExportPng()}
              className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-white/15 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 text-slate-800 dark:text-slate-100 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60 transition-colors"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>{busyAction === 'png' ? 'Guardando…' : 'Imagen PNG'}</span>
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => void handlePrint()}
              className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-white/15 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 text-slate-800 dark:text-slate-100 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{busyAction === 'print' ? 'Preparando…' : 'Imprimir'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar vista previa del recibo"
              className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {exportError && (
          <div className="rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-200">
            {exportError}
          </div>
        )}

        {/* Crisp Printable Corporate Receipt Paper */}
        <div
          className="relative overflow-hidden rounded-[22px] bg-white text-slate-900 shadow-2xl border-[3px]"
          style={{ borderColor: palette.primary }}
        >
          {/* Top Header Zone */}
          <div className="relative flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5">
            {/* Institutional Logo + Vertical Divider + Brand Name */}
            <div className="flex items-center gap-3.5 pt-5 px-5 sm:pr-2 min-w-0 z-10">
              <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 flex items-center justify-center">
                {viewData.logoUrl && !logoFailed ? (
                  <img
                    src={viewData.logoUrl}
                    alt={`Logo de ${viewData.institutionName}`}
                    referrerPolicy="no-referrer"
                    onError={() => setLogoFailed(true)}
                    className="max-w-full max-h-full w-auto h-auto object-contain"
                  />
                ) : (
                  <div
                    className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center text-white font-display font-extrabold text-xl sm:text-2xl shadow-sm"
                    style={{
                      background: `linear-gradient(135deg, ${palette.primaryDark}, ${palette.accent})`,
                    }}
                  >
                    {viewData.institutionInitials}
                  </div>
                )}
              </div>

              <div
                className="w-[2px] self-stretch my-1 shrink-0 rounded-full"
                style={{ backgroundColor: palette.primary }}
                aria-hidden="true"
              />

              <div className="min-w-0">
                <div
                  className="font-display font-extrabold text-xl sm:text-2xl leading-tight tracking-tight truncate"
                  style={{ color: palette.primaryDark }}
                >
                  {viewData.institutionNameTop}
                </div>
                {viewData.institutionNameBottom && (
                  <div
                    className="font-display font-extrabold text-lg sm:text-xl leading-tight tracking-tight truncate"
                    style={{ color: palette.accent }}
                  >
                    {viewData.institutionNameBottom}
                  </div>
                )}
                <p
                  className="text-[11px] sm:text-xs font-semibold italic mt-1 leading-snug break-words"
                  style={{ color: palette.primary }}
                >
                  {viewData.institutionSubtitle}
                </p>
              </div>
            </div>

            {/* Top-Right "Recibo de Pago" Banner */}
            <div className="relative self-end sm:self-start shrink-0 z-10">
              <div
                className="px-6 sm:px-8 py-4 sm:py-5 text-white text-center sm:rounded-bl-[44px] rounded-tl-[28px] sm:rounded-tl-none"
                style={{
                  background: `linear-gradient(135deg, ${palette.primaryDark}, ${palette.primary})`,
                }}
              >
                <div className="font-display font-extrabold text-2xl sm:text-[28px] leading-none tracking-tight whitespace-nowrap">
                  Recibo de Pago
                </div>
                <div className="font-mono tabular-nums font-semibold text-base sm:text-lg mt-1.5 opacity-95 whitespace-nowrap">
                  N° {viewData.displayReceiptNumber}
                </div>
              </div>
            </div>

            {/* Dual-Tone Curved Header Swoosh */}
            <svg
              viewBox="0 0 700 44"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none hidden sm:block absolute right-0 bottom-0 w-[60%] h-9"
            >
              <path
                d="M12,42 C180,8 460,24 700,0 L700,19 C470,38 190,18 12,42 Z"
                fill={palette.ribbonHighlight}
              />
              <path
                d="M360,30 C490,32 605,28 700,17 L700,30 C605,36 490,36 360,30 Z"
                fill={palette.primary}
              />
            </svg>
          </div>

          {/* Receipt Body */}
          <div className="px-5 sm:px-6 pb-5 space-y-4">
            {viewData.status === 'ANULADO_POR_REVERSO' && (
              <div className="rounded-xl bg-rose-50 border border-rose-500 px-4 py-2 text-center text-xs font-extrabold text-rose-700 tracking-wide">
                RECIBO ANULADO POR REVERSO AUTORIZADO — SIN VALIDEZ DE COBRO
              </div>
            )}

            {/* Cliente & Crédito Card */}
            <div
              className="rounded-2xl border px-4 sm:px-5 py-3.5 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-0 items-center"
              style={{
                backgroundColor: palette.softSurface,
                borderColor: palette.softBorder,
              }}
            >
              <div className="flex items-start gap-3 sm:pr-5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                  style={{ color: palette.primary }}
                >
                  <User className="w-8 h-8 fill-current" />
                </div>
                <div className="min-w-0">
                  <div
                    className="text-xs font-bold"
                    style={{ color: palette.primary }}
                  >
                    Cliente:
                  </div>
                  <div className="text-sm sm:text-base font-extrabold text-slate-950 leading-snug break-words">
                    {viewData.customerName}
                  </div>
                  <div className="text-xs sm:text-[13px] font-medium text-slate-700 mt-0.5 tabular-nums">
                    {viewData.customerDocumentLabel} {viewData.customerDocumentValue}
                  </div>
                </div>
              </div>

              <div
                className="flex items-start gap-3 sm:pl-5 sm:border-l-[2px]"
                style={{ borderColor: palette.primary }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                  style={{ color: palette.primary }}
                >
                  <FileText className="w-8 h-8" />
                </div>
                <div className="min-w-0">
                  <div
                    className="text-xs font-bold"
                    style={{ color: palette.primary }}
                  >
                    Crédito:
                  </div>
                  <div className="text-xs sm:text-[13px] font-semibold text-slate-900 mt-0.5 tabular-nums">
                    Préstamo N°: <span className="font-bold">{viewData.loanNumber}</span>
                  </div>
                  <div className="text-xs sm:text-[13px] font-medium text-slate-700 mt-0.5 truncate">
                    Producto: {viewData.productLabel}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 1: Detalle del Pago */}
            <div
              className="rounded-2xl overflow-hidden border-[1.5px] bg-white"
              style={{ borderColor: palette.primary }}
            >
              <div
                className="px-4 sm:px-5 py-2.5 flex items-center gap-2.5 text-white"
                style={{
                  background: `linear-gradient(90deg, ${palette.primaryDark}, ${palette.primary})`,
                }}
              >
                <Coins className="w-5 h-5 shrink-0" />
                <span className="font-display font-bold text-base sm:text-lg tracking-tight">
                  Detalle del Pago
                </span>
              </div>
              <div className="px-5 sm:px-6 py-2.5 space-y-2">
                {viewData.lineItems.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-4 text-sm sm:text-base text-slate-900"
                  >
                    <span className="font-medium">{item.label}</span>
                    <span className="font-mono tabular-nums font-semibold">
                      {item.amountFormatted}
                    </span>
                  </div>
                ))}
              </div>
              <div
                className="px-5 sm:px-6 py-3 flex items-center justify-between gap-4"
                style={{ backgroundColor: palette.totalBand, color: palette.primaryDark }}
              >
                <span className="font-display font-extrabold text-base sm:text-xl">
                  Total Pagado:
                </span>
                <span className="font-mono tabular-nums font-extrabold text-lg sm:text-xl">
                  {viewData.totalPaidFormatted}
                </span>
              </div>
            </div>

            {/* Section 2: Resumen de Cuenta */}
            <div
              className="rounded-2xl overflow-hidden border-[1.5px] bg-white"
              style={{ borderColor: palette.primary }}
            >
              <div
                className="px-4 sm:px-5 py-2.5 flex items-center gap-2.5 text-white"
                style={{
                  background: `linear-gradient(90deg, ${palette.primaryDark}, ${palette.primary})`,
                }}
              >
                <BarChart3 className="w-5 h-5 shrink-0" />
                <span className="font-display font-bold text-base sm:text-lg tracking-tight">
                  Resumen de Cuenta
                </span>
              </div>
              <div className="px-5 sm:px-6 py-3 space-y-2">
                <div className="flex items-center justify-between gap-4 text-sm sm:text-base text-slate-900">
                  <span className="font-medium">Saldo Anterior:</span>
                  <span className="font-mono tabular-nums font-semibold">
                    {viewData.previousBalanceFormatted}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm sm:text-base text-slate-950">
                  <span className="font-bold">Nuevo Saldo:</span>
                  <span
                    className="font-mono tabular-nums font-extrabold"
                    style={{ color: palette.primaryDark }}
                  >
                    {viewData.newBalanceFormatted}
                  </span>
                </div>
              </div>
            </div>

            {/* 3-Column Metadata Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-0 pt-2 items-center">
              <div className="flex items-center gap-2.5 sm:pr-4">
                <Calendar
                  className="w-7 h-7 shrink-0"
                  style={{ color: palette.primary }}
                />
                <div>
                  <div className="text-xs font-medium text-slate-600">Fecha de Pago:</div>
                  <div className="text-sm sm:text-base font-mono tabular-nums font-bold text-slate-950">
                    {viewData.paymentDateFormatted}
                  </div>
                </div>
              </div>

              <div
                className="flex items-center gap-2.5 sm:px-4 sm:border-l-[2px]"
                style={{ borderColor: palette.primary }}
              >
                <Clock
                  className="w-7 h-7 shrink-0"
                  style={{ color: palette.primary }}
                />
                <div>
                  <div className="text-xs font-medium text-slate-600">Hora:</div>
                  <div className="text-sm sm:text-base font-mono tabular-nums font-bold text-slate-950">
                    {viewData.paymentTimeFormatted}
                  </div>
                </div>
              </div>

              <div
                className="flex items-center gap-2.5 sm:pl-4 sm:border-l-[2px]"
                style={{ borderColor: palette.primary }}
              >
                <CreditCard
                  className="w-7 h-7 shrink-0"
                  style={{ color: palette.primary }}
                />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-600">Método:</div>
                  <div className="text-sm sm:text-base font-bold text-slate-950 truncate">
                    {viewData.paymentMethodLabel}
                  </div>
                </div>
              </div>
            </div>

            {/* Closing Thank-You Message & Signature */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-3 pb-1">
              <div className="min-w-0">
                <p
                  className="italic font-bold text-xl sm:text-2xl leading-snug"
                  style={{
                    color: palette.primaryDark,
                    fontFamily: '"Brush Script MT", "Segoe Script", Georgia, serif',
                  }}
                >
                  {viewData.thankYouMessage}
                </p>
                <svg
                  viewBox="0 0 260 14"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  className="w-48 h-2.5 mt-0.5 ml-14"
                >
                  <path
                    d="M2,12 Q130,0 258,12 Q130,5 2,12 Z"
                    fill={palette.ribbonHighlight}
                  />
                </svg>
                {(viewData.referenceNumber || viewData.issuedByName) && (
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    {viewData.referenceNumber ? `Ref.: ${viewData.referenceNumber}` : ''}
                    {viewData.referenceNumber && viewData.issuedByName ? ' · ' : ''}
                    {viewData.issuedByName ? `Validado por: ${viewData.issuedByName}` : ''}
                  </p>
                )}
              </div>

              <div className="sm:w-52 shrink-0 text-center">
                <div
                  className="h-[2px] w-full mb-1.5"
                  style={{ backgroundColor: palette.primary }}
                />
                <div className="text-[11px] font-semibold text-slate-600">
                  Autorizado por
                </div>
                <div
                  className="text-xs sm:text-sm font-extrabold italic truncate"
                  style={{ color: palette.primaryDark }}
                >
                  {viewData.institutionName}
                </div>
              </div>
            </div>
          </div>

          {/* Sweeping Corporate Bottom Wave */}
          <svg
            viewBox="0 0 700 44"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="block w-full h-9"
          >
            <path
              d="M0,20 C175,-6 475,44 700,10 L700,44 L0,44 Z"
              fill={palette.primary}
            />
            <path
              d="M0,25 C170,0 475,48 700,15"
              fill="none"
              stroke="rgba(255,255,255,0.85)"
              strokeWidth="3"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
