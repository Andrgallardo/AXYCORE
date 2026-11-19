import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Info, ShieldCheck } from 'lucide-react';
import type { CurrencyCode } from '../../types/axycore';
import type {
  AlteraExplainabilityBlock,
  AlteraInterventionType,
  AlteraPriority,
  AlteraRecommendationStatus,
} from '../../types/altera';

export const INTERVENTION_LABELS: Record<AlteraInterventionType, string> = {
  ABONO_EXTRAORDINARIO: 'Abono Extraordinario a Capital',
  CAMBIO_FECHA_PAGO: 'Cambio de Fecha de Pago',
  REESTRUCTURACION_PLAZO: 'Reestructuración de Plazo / Tasa',
  REDUCCION_TEMPORAL_CUOTA: 'Reducción Temporal de Cuota',
  ESTRATEGIA_COBRANZA_PREVENTIVA: 'Estrategia de Cobranza Preventiva',
  PAGO_PARCIAL_CONTROLADO: 'Pago Parcial Controlado',
};

export const PRIORITY_STYLES: Record<AlteraPriority, string> = {
  CRITICA:
    'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/35',
  ALTA:
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/35',
  MEDIA:
    'bg-sky-500/15 text-sky-700 dark:text-[#00D1FF] border border-sky-500/35',
  BAJA:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/35',
};

export const REC_STATUS_LABELS: Record<AlteraRecommendationStatus, string> = {
  GENERADA: 'Generada',
  PENDIENTE_REVISION: 'Pendiente de Revisión',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
  EN_EJECUCION: 'En Ejecución',
  EJECUTADA: 'Ejecutada',
  CERRADA: 'Cerrada',
};

export const REC_STATUS_STYLES: Record<AlteraRecommendationStatus, string> = {
  GENERADA:
    'bg-slate-500/15 text-slate-700 dark:text-slate-300 border border-slate-400/30',
  PENDIENTE_REVISION:
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/35',
  APROBADA:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/35',
  RECHAZADA:
    'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/35',
  EN_EJECUCION:
    'bg-[#0066FF]/15 text-[#0052CC] dark:text-[#00D1FF] border border-[#00B8FF]/35',
  EJECUTADA:
    'bg-teal-500/15 text-teal-700 dark:text-teal-300 border border-teal-500/35',
  CERRADA:
    'bg-slate-600/15 text-slate-600 dark:text-slate-400 border border-slate-500/30',
};

export function formatAlteraMoney(amount: number, currency: CurrencyCode = 'DOP'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AlteraExplainabilityPanel({
  explainability,
  title = 'Inteligencia Explicable — Fundamento Técnico de ALTERA',
  defaultOpen = false,
}: {
  explainability: AlteraExplainabilityBlock;
  title?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50/80 dark:bg-[#040C1E]/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-100/80 dark:hover:bg-[#08132B]/70 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <ShieldCheck className="w-4 h-4 text-[#0052CC] dark:text-[#00D1FF] shrink-0" />
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] font-mono font-semibold text-[#0052CC] dark:text-[#00D1FF]">
            Confianza {explainability.confidencePct}%
          </span>
          {open ? (
            <ChevronUp className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          )}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-200/80 dark:border-[#00B8FF]/15 space-y-3 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-white/10 space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Qué se detectó
              </p>
              <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                {explainability.whatWasDetected}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-white/10 space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Por qué existe el riesgo / oportunidad
              </p>
              <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                {explainability.whyRiskOrOpportunityExists}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-white/10 space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Por qué se recomienda
              </p>
              <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                {explainability.whyRecommended}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-white/10 space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Si no se actúa
              </p>
              <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                {explainability.expectedOutcomeIfNoAction}
              </p>
            </div>
          </div>

          {explainability.variablesConsidered.length > 0 && (
            <div className="p-3 rounded-lg bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-white/10 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Variables reales evaluadas
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {explainability.variablesConsidered.map((v, idx) => (
                  <div
                    key={idx}
                    className="px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-[#040C1E] border border-slate-200/70 dark:border-white/5"
                  >
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{v.label}</p>
                    <p className="font-mono font-semibold text-slate-900 dark:text-white">{v.value}</p>
                    <p className="text-[10px] text-[#0052CC] dark:text-[#00D1FF]">
                      Peso/Impacto: {v.weightOrImpact}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Fuentes reales de AxyCore
              </p>
              <ul className="space-y-1 text-slate-700 dark:text-slate-300 list-disc pl-4">
                {explainability.dataUsed.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Alternativas comparadas
              </p>
              <ul className="space-y-1 text-slate-700 dark:text-slate-300 list-disc pl-4">
                {explainability.alternativesEvaluated.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          </div>

          {explainability.dataLimitations.length > 0 && (
            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-start gap-2 text-amber-800 dark:text-amber-300">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Limitaciones de datos transparentadas:</p>
                <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                  {explainability.dataLimitations.map((lim, i) => (
                    <li key={i}>{lim}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
