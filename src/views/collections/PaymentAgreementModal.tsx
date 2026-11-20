import React, { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, Handshake, X } from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import { getSantoDomingoTodayIso } from '../../engine/collections/delinquencyEngine';
import { proposePaymentAgreement } from '../../services/collectionsStore';
import type { CollectionAccountRecord, PaymentAgreementRecord } from '../../types/axycore';
import { formatMoney } from '../../utils/formatters';

interface PaymentAgreementModalProps {
  account: CollectionAccountRecord | null;
  onClose: () => void;
  onSaved?: (msg: string) => void;
}

export function PaymentAgreementModal({
  account,
  onClose,
  onSaved,
}: PaymentAgreementModalProps) {
  const { userProfile, rbac } = useAxyCore();
  const canActivateDirectly = rbac.hasPermission('RESOLVE_DISPUTES_AND_AGREEMENTS');

  const [agreementType, setAgreementType] =
    useState<PaymentAgreementRecord['agreementType']>('ACUERDO_PAGO');
  const [totalAgreedAmount, setTotalAgreedAmount] = useState('');
  const [downPaymentAmount, setDownPaymentAmount] = useState('0');
  const [installmentCount, setInstallmentCount] = useState('3');
  const [firstDueDate, setFirstDueDate] = useState(getSantoDomingoTodayIso());
  const [notes, setNotes] = useState('');
  const [activateImmediately, setActivateImmediately] = useState(canActivateDirectly);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    const defaultTotal =
      account.overdueTotalAmount > 0
        ? account.overdueTotalAmount
        : account.totalOutstandingPrincipal;
    setAgreementType('ACUERDO_PAGO');
    setTotalAgreedAmount(defaultTotal > 0 ? String(Math.round(defaultTotal * 100) / 100) : '');
    setDownPaymentAmount('0');
    setInstallmentCount('3');
    setFirstDueDate(getSantoDomingoTodayIso());
    setNotes('');
    setActivateImmediately(canActivateDirectly);
    setError(null);
  }, [account, canActivateDirectly]);

  if (!account) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;

    const totalNum = Number(totalAgreedAmount);
    const downNum = Number(downPaymentAmount || 0);
    const countNum = Number(installmentCount || 1);

    if (!Number.isFinite(totalNum) || totalNum <= 0) {
      setError('El monto total del acuerdo debe ser mayor que cero.');
      return;
    }
    if (notes.trim().length < 5) {
      setError('Ingresa las condiciones y motivo del acuerdo (mínimo 5 caracteres).');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await proposePaymentAgreement({
        account,
        agreementType,
        totalAgreedAmount: totalNum,
        downPaymentAmount: Number.isFinite(downNum) && downNum >= 0 ? downNum : 0,
        installmentCount: Number.isFinite(countNum) && countNum >= 1 ? Math.round(countNum) : 1,
        firstDueDate,
        notes,
        activateImmediately: activateImmediately && agreementType === 'ACUERDO_PAGO',
        user: userProfile,
      });

      const statusText =
        res.status === 'ACTIVO'
          ? 'registrado y ACTIVADO para seguimiento'
          : 'registrado en estado PROPUESTO para aprobación';
      onSaved?.(
        `Acuerdo de pago (${account.loanNumber} · ${account.applicantDisplayName}) ${statusText}.`
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el acuerdo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#030816]/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl axy-surface axy-panel-in shadow-2xl overflow-hidden text-xs">
        <div className="h-[2px] w-full axy-infinity-line" />
        <div className="px-5 py-4 border-b border-[var(--axy-border)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[#0052CC] dark:text-[#00D1FF] font-semibold">
              <Handshake className="w-4 h-4 shrink-0" />
              <span>Registrar Acuerdo de Pago</span>
            </div>
            <h3 className="font-display text-base font-bold text-slate-950 dark:text-white truncate mt-0.5">
              {account.applicantDisplayName} · <span className="font-mono">{account.loanNumber}</span>
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 axy-btn-secondary text-slate-500 cursor-pointer"
            aria-label="Cerrar modal de acuerdo"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Context Strip */}
          <div className="grid grid-cols-3 gap-3 p-3 rounded-xl axy-surface-tonal">
            <div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Días de Atraso</span>
              <span className="font-mono tabular-nums font-bold text-rose-700 dark:text-rose-400">
                {account.dpd} DPD
              </span>
            </div>
            <div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Monto Vencido</span>
              <span className="font-mono tabular-nums font-bold text-slate-950 dark:text-white">
                {formatMoney(account.overdueTotalAmount, account.currency)}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Saldo Capital</span>
              <span className="font-mono tabular-nums font-bold text-slate-950 dark:text-white">
                {formatMoney(account.totalOutstandingPrincipal, account.currency)}
              </span>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 font-medium text-slate-600 dark:text-slate-300">
                Tipo de Acuerdo
              </label>
              <select
                value={agreementType}
                onChange={(e) =>
                  setAgreementType(e.target.value as PaymentAgreementRecord['agreementType'])
                }
                className="w-full px-3 py-2 axy-input text-slate-950 dark:text-white"
              >
                <option value="ACUERDO_PAGO">Acuerdo de Pago</option>
                <option value="REESTRUCTURACION">Reestructuración</option>
                <option value="REFINANCIAMIENTO">Refinanciamiento</option>
              </select>
            </div>

            <div>
              <label className="block mb-1 font-medium text-slate-600 dark:text-slate-300">
                Fecha de Cumplimiento / Primer Pago *
              </label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                <input
                  type="date"
                  required
                  value={firstDueDate}
                  onChange={(e) => setFirstDueDate(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 axy-input font-mono text-slate-950 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block mb-1 font-medium text-slate-600 dark:text-slate-300">
                Monto Total Acordado ({account.currency}) *
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={totalAgreedAmount}
                onChange={(e) => setTotalAgreedAmount(e.target.value)}
                className="w-full px-3 py-2 axy-input font-mono tabular-nums text-slate-950 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block mb-1 font-medium text-slate-600 dark:text-slate-300">
                  Abono Inicial
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={downPaymentAmount}
                  onChange={(e) => setDownPaymentAmount(e.target.value)}
                  className="w-full px-2.5 py-2 axy-input font-mono tabular-nums text-slate-950 dark:text-white"
                />
              </div>
              <div>
                <label className="block mb-1 font-medium text-slate-600 dark:text-slate-300">
                  Cuotas
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={installmentCount}
                  onChange={(e) => setInstallmentCount(e.target.value)}
                  className="w-full px-2.5 py-2 axy-input font-mono tabular-nums text-slate-950 dark:text-white"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block mb-1 font-medium text-slate-600 dark:text-slate-300">
              Condiciones y Compromiso del Cliente *
            </label>
            <textarea
              rows={3}
              required
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. Cliente se compromete a depositar inicial hoy antes de las 4:00 PM y saldar cuotas quincenales..."
              className="w-full px-3 py-2 axy-input text-slate-950 dark:text-white"
            />
          </div>

          {canActivateDirectly && agreementType === 'ACUERDO_PAGO' && (
            <label className="flex items-center gap-2 p-2.5 rounded-xl bg-sky-50/70 dark:bg-[#0066FF]/10 border border-sky-200/80 dark:border-[#00B8FF]/20 cursor-pointer">
              <input
                type="checkbox"
                checked={activateImmediately}
                onChange={(e) => setActivateImmediately(e.target.checked)}
              />
              <span className="text-slate-700 dark:text-slate-200 font-medium">
                Activar acuerdo inmediatamente para seguimiento en Gestiones de Cobros
              </span>
            </label>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--axy-border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 axy-btn-secondary font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 axy-btn-primary cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {busy ? 'Guardando...' : 'Guardar Acuerdo de Pago'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
