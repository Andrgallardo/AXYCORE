import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  Download,
  FileSpreadsheet,
  Filter,
} from 'lucide-react';
import {
  buildAmortizationCsv,
  getInstallmentRemainingComponents,
} from '../../engine/clientPortalHealthEngine';
import type { LoanInstallmentRecord, LoanRecord } from '../../types/axycore';
import { formatMoney } from '../../utils/formatters';

type ScheduleFilter = 'TODAS' | 'PENDIENTES' | 'PAGADAS' | 'VENCIDAS';

interface ClientAmortizationPanelProps {
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  loading: boolean;
  onPayInstallment: (amount: number, installmentNumber: number, dueDate: string) => void;
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('es-DO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const STATUS_META: Record<
  LoanInstallmentRecord['status'],
  { label: string; textClass: string; rowClass: string }
> = {
  PAGADA: {
    label: 'Pagada',
    textClass: 'text-emerald-600 dark:text-emerald-400',
    rowClass: 'bg-emerald-500/[0.02]',
  },
  PARCIAL: {
    label: 'Pago parcial',
    textClass: 'text-sky-600 dark:text-[#00D1FF]',
    rowClass: 'bg-sky-500/[0.04]',
  },
  VENCIDA: {
    label: 'Vencida',
    textClass: 'text-rose-600 dark:text-rose-400',
    rowClass: 'bg-rose-500/[0.05]',
  },
  PENDIENTE: {
    label: 'Pendiente',
    textClass: 'text-amber-600 dark:text-[#E2B35E]',
    rowClass: '',
  },
};

export function ClientAmortizationPanel({
  loan,
  installments,
  loading,
  onPayInstallment,
}: ClientAmortizationPanelProps) {
  const [filter, setFilter] = useState<ScheduleFilter>('TODAS');
  const [exportedFeedback, setExportedFeedback] = useState(false);

  const sorted = useMemo(
    () => [...installments].sort((a, b) => a.installmentNumber - b.installmentNumber),
    [installments]
  );

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const counts = useMemo(() => {
    let pagadas = 0;
    let vencidas = 0;
    let pendientes = 0;
    let totalPrincipal = 0;
    let totalInterest = 0;
    let totalLateFee = 0;
    let totalPaid = 0;

    for (const inst of sorted) {
      const comp = getInstallmentRemainingComponents(inst);
      totalPrincipal += inst.principalAmount || 0;
      totalInterest += inst.interestAmount || 0;
      totalLateFee += comp.remainingLateFee;
      totalPaid +=
        (inst.paidPrincipal || 0) +
        (inst.paidInterest || 0) +
        (inst.paidOtherCharges || 0) +
        (inst.paidLateFee || 0);

      if (inst.status === 'PAGADA') {
        pagadas += 1;
      } else if (inst.status === 'VENCIDA' || (inst.dueDate < todayIso && comp.remainingBase > 0.01)) {
        vencidas += 1;
      } else {
        pendientes += 1;
      }
    }

    return {
      todas: sorted.length,
      pagadas,
      vencidas,
      pendientes,
      totalPrincipal,
      totalInterest,
      totalLateFee,
      totalPaid,
    };
  }, [sorted, todayIso]);

  const nextDueNumber = useMemo(() => {
    const found = sorted.find((i) => i.status !== 'PAGADA');
    return found?.installmentNumber ?? null;
  }, [sorted]);

  const filteredRows = useMemo(() => {
    if (filter === 'TODAS') return sorted;
    return sorted.filter((inst) => {
      const comp = getInstallmentRemainingComponents(inst);
      const isOverdue =
        inst.status !== 'PAGADA' &&
        (inst.status === 'VENCIDA' || (inst.dueDate < todayIso && comp.remainingBase > 0.01));
      if (filter === 'PAGADAS') return inst.status === 'PAGADA';
      if (filter === 'VENCIDAS') return isOverdue;
      return inst.status !== 'PAGADA' && !isOverdue;
    });
  }, [sorted, filter, todayIso]);

  const handleDownloadCsv = () => {
    const csv = buildAmortizationCsv(loan, sorted);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tabla_amortizacion_${loan.loanNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExportedFeedback(true);
    setTimeout(() => setExportedFeedback(false), 2600);
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden shadow-xs">
      {/* Header & Controls */}
      <div className="px-5 py-4 border-b border-slate-200/80 dark:border-[#00B8FF]/15 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
            <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
              Tabla de Amortización · {loan.loanNumber}
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Método:{' '}
            <strong className="text-slate-700 dark:text-slate-200">
              {loan.amortizationMethod === 'SALDO_INSOLUTO'
                ? 'Cuota Nivelada (Saldo Insoluto)'
                : 'Interés Fijo'}
            </strong>{' '}
            · Frecuencia: {loan.frequency} · Haz clic en «Pagar cuota» para reportar un abono exacto.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-xl bg-slate-100 dark:bg-[#040C1E] p-1 border border-slate-200/80 dark:border-white/10">
            {(
              [
                { id: 'TODAS', label: `Todas (${counts.todas})` },
                { id: 'PENDIENTES', label: `Pendientes (${counts.pendientes})` },
                { id: 'VENCIDAS', label: `Vencidas (${counts.vencidas})` },
                { id: 'PAGADAS', label: `Pagadas (${counts.pagadas})` },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  filter === opt.id
                    ? 'bg-white dark:bg-[#0D1E42] text-slate-950 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={sorted.length === 0}
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-[#040C1E] hover:bg-slate-200 dark:hover:bg-[#0D1E42] border border-slate-200 dark:border-[#00B8FF]/25 text-slate-800 dark:text-slate-200 text-xs font-semibold cursor-pointer whitespace-nowrap disabled:opacity-45 transition-colors"
          >
            {exportedFeedback ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>CSV Descargado</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
                <span>Descargar CSV</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Totals Telemetry Bar */}
      {sorted.length > 0 && (
        <div className="px-5 py-3 bg-slate-50/75 dark:bg-[#050E22] border-b border-slate-200/70 dark:border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
              Capital Programado
            </span>
            <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
              {formatMoney(counts.totalPrincipal, loan.currency)}
            </span>
          </div>
          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
              Interés Contractual
            </span>
            <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
              {formatMoney(counts.totalInterest, loan.currency)}
            </span>
          </div>
          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
              Abonado Confirmado
            </span>
            <span className="font-mono tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
              {formatMoney(counts.totalPaid, loan.currency)}
            </span>
          </div>
          <div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
              Mora Pendiente
            </span>
            <span
              className={`font-mono tabular-nums font-bold ${
                counts.totalLateFee > 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {formatMoney(counts.totalLateFee, loan.currency)}
            </span>
          </div>
        </div>
      )}

      {/* Amortization Schedule Table */}
      {loading ? (
        <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
          Cargando calendario de cuotas oficial...
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="p-8 text-center space-y-2">
          <Filter className="w-6 h-6 mx-auto text-slate-400" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {sorted.length === 0
              ? 'No hay cuotas registradas para este préstamo todavía.'
              : 'No hay cuotas que coincidan con el filtro seleccionado.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100/95 dark:bg-[#040C1E]/95 backdrop-blur-xs text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/10">
              <tr>
                <th className="py-3 px-4 font-semibold">Cuota</th>
                <th className="py-3 px-4 font-semibold">Vencimiento</th>
                <th className="py-3 px-4 font-semibold text-right">Capital</th>
                <th className="py-3 px-4 font-semibold text-right">Interés</th>
                <th className="py-3 px-4 font-semibold text-right">Mora</th>
                <th className="py-3 px-4 font-semibold text-right">Total Cuota</th>
                <th className="py-3 px-4 font-semibold text-right">Saldo Restante</th>
                <th className="py-3 px-4 font-semibold">Estado</th>
                <th className="py-3 px-4 font-semibold text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
              {filteredRows.map((inst) => {
                const comp = getInstallmentRemainingComponents(inst);
                const isOverdueByDate =
                  inst.status !== 'PAGADA' &&
                  (inst.status === 'VENCIDA' ||
                    (inst.dueDate < todayIso && comp.remainingBase > 0.01));
                const effectiveStatus: LoanInstallmentRecord['status'] = isOverdueByDate
                  ? 'VENCIDA'
                  : inst.status;
                const meta = STATUS_META[effectiveStatus] || STATUS_META.PENDIENTE;
                const isNextDue = inst.installmentNumber === nextDueNumber;
                const canPay = inst.status !== 'PAGADA' && comp.remainingTotalWithLateFee > 0.01;

                return (
                  <tr
                    key={inst.id}
                    className={`transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03] ${
                      meta.rowClass
                    } ${isNextDue ? 'bg-[#0066FF]/[0.04] dark:bg-[#00B8FF]/[0.06]' : ''}`}
                  >
                    <td className="py-3 px-4 font-mono tabular-nums font-bold text-slate-900 dark:text-white whitespace-nowrap">
                      #{inst.installmentNumber}
                      {isNextDue && (
                        <span className="ml-2 text-[10px] font-sans font-semibold uppercase tracking-wider text-[#0066FF] dark:text-[#00D1FF]">
                          · Próxima
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {formatShortDate(inst.dueDate)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {formatMoney(inst.principalAmount, loan.currency)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {formatMoney(inst.interestAmount, loan.currency)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right whitespace-nowrap">
                      {comp.remainingLateFee > 0 ? (
                        <span className="text-rose-600 dark:text-rose-400 font-semibold">
                          {formatMoney(comp.remainingLateFee, loan.currency)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right font-bold text-slate-950 dark:text-white whitespace-nowrap">
                      {formatMoney(inst.totalAmount, loan.currency)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {formatMoney(inst.remainingPrincipalBalance, loan.currency)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`font-semibold text-[11px] ${meta.textClass}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {canPay ? (
                        <button
                          type="button"
                          onClick={() =>
                            onPayInstallment(
                              comp.remainingTotalWithLateFee,
                              inst.installmentNumber,
                              inst.dueDate
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0066FF]/10 hover:bg-[#0066FF]/20 text-[#0052CC] dark:text-[#00D1FF] text-[11px] font-semibold cursor-pointer transition-colors"
                        >
                          <CreditCard className="w-3 h-3" />
                          <span>Pagar cuota</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                          Cubierta
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
