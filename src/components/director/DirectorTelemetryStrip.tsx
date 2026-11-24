import React from 'react';
import type { ExecutiveCurrencyMetrics } from '../../engine/executiveAnalytics';
import type { CurrencyCode, ExecutiveCurrencyMode } from '../../types/axycore';
import { formatMoney } from '../../utils/formatters';

interface DirectorTelemetryStripProps {
  primaryMetrics: ExecutiveCurrencyMetrics;
  primaryCurrency: CurrencyCode;
  executiveCurrency: ExecutiveCurrencyMode;
  dopMetrics: ExecutiveCurrencyMetrics;
  usdMetrics: ExecutiveCurrencyMetrics;
  periodLabel: string;
  activeSentinelCount: number;
  pendingPaymentsCount: number;
  isUpdating?: boolean;
}

export const DirectorTelemetryStrip = React.memo(function DirectorTelemetryStrip({
  primaryMetrics,
  primaryCurrency,
  executiveCurrency,
  dopMetrics,
  usdMetrics,
  periodLabel,
  activeSentinelCount,
  pendingPaymentsCount,
  isUpdating = false,
}: DirectorTelemetryStripProps) {
  return (
    <div
      className={`grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 transition-opacity duration-200 ${
        isUpdating ? 'opacity-75' : 'opacity-100'
      }`}
    >
      <div className="p-3 rounded-xl bg-[#071430]/95 border border-[#00B8FF]/15">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
          Cartera Activa ({primaryCurrency})
        </span>
        <strong className="font-mono tabular-nums text-sm text-white block mt-0.5">
          {formatMoney(primaryMetrics.activePortfolioCapital, primaryCurrency)}
        </strong>
        <span className="text-[10px] text-slate-400 font-mono">
          {primaryMetrics.activeLoansCount} préstamos
          {executiveCurrency === 'SEPARATED' && usdMetrics.activeLoansCount > 0
            ? ` · +${formatMoney(usdMetrics.activePortfolioCapital, 'USD')}`
            : ''}
        </span>
      </div>

      <div className="p-3 rounded-xl bg-[#071430]/95 border border-[#00B8FF]/15">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
          Desembolsos ({periodLabel})
        </span>
        <strong className="font-mono tabular-nums text-sm text-[#00D1FF] block mt-0.5">
          {formatMoney(primaryMetrics.disbursedPeriodTotal, primaryCurrency)}
        </strong>
        <span className="text-[10px] text-slate-400 font-mono">
          {primaryMetrics.disbursedPeriodCount} operación(es)
        </span>
      </div>

      <div className="p-3 rounded-xl bg-[#071430]/95 border border-[#00B8FF]/15">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
          Recuperación Aplicada
        </span>
        <strong className="font-mono tabular-nums text-sm text-emerald-400 block mt-0.5">
          {formatMoney(primaryMetrics.recoveryPeriodTotal, primaryCurrency)}
        </strong>
        <span className="text-[10px] text-slate-400 font-mono">
          {primaryMetrics.recoveryPaymentsCount} pago(s)
        </span>
      </div>

      <div className="p-3 rounded-xl bg-[#071430]/95 border border-[#00B8FF]/15">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
          Morosidad PAR 30
        </span>
        <strong className="font-mono tabular-nums text-sm text-[#E2B35E] block mt-0.5">
          {primaryMetrics.par30Pct !== null ? `${primaryMetrics.par30Pct}%` : '0.00%'}
        </strong>
        <span className="text-[10px] text-slate-400 font-mono">
          PAR 1: {primaryMetrics.par1Pct !== null ? `${primaryMetrics.par1Pct}%` : '0.00%'}
        </span>
      </div>

      <div className="p-3 rounded-xl bg-[#071430]/95 border border-[#00B8FF]/15">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
          Solicitudes en Cola
        </span>
        <strong className="font-mono tabular-nums text-sm text-white block mt-0.5">
          {dopMetrics.pendingApplicationsCount + usdMetrics.pendingApplicationsCount}
        </strong>
        <span className="text-[10px] text-slate-400 font-mono">
          Aprob.: {primaryMetrics.approvalsRatePct !== null ? `${primaryMetrics.approvalsRatePct}%` : 'N/A'}
        </span>
      </div>

      <div className="p-3 rounded-xl bg-[#071430]/95 border border-[#00B8FF]/15">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
          Centinela / Pagos Pend.
        </span>
        <strong className="font-mono tabular-nums text-sm text-rose-400 block mt-0.5">
          {activeSentinelCount} / {pendingPaymentsCount}
        </strong>
        <span className="text-[10px] text-slate-400 font-mono">
          Alertas activas / validar
        </span>
      </div>
    </div>
  );
});
