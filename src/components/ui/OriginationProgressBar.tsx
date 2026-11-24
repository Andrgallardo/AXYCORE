import React from 'react';
import { AlertCircle, Check } from 'lucide-react';
import type { ApplicationFormStep } from '../../engine/applicationFieldValidation';
import {
  ORIGINATION_STEPS,
  computeOriginationProgress,
} from '../../engine/originationProgress';

interface OriginationProgressBarProps {
  currentStep: ApplicationFormStep;
  stepValid: Record<ApplicationFormStep, boolean>;
  stepErrorCounts: Record<ApplicationFormStep, number>;
  attemptedSteps: Partial<Record<ApplicationFormStep, boolean>>;
  onSelectStep: (step: ApplicationFormStep) => void;
  variant?: 'surface' | 'dark';
  primaryColor?: string;
  accentColor?: string;
}

export const OriginationProgressBar: React.FC<OriginationProgressBarProps> = ({
  currentStep,
  stepValid,
  stepErrorCounts,
  attemptedSteps,
  onSelectStep,
  variant = 'surface',
  primaryColor,
  accentColor,
}) => {
  const progress = computeOriginationProgress({
    currentStep,
    stepValid,
    stepErrorCounts,
    attemptedSteps,
  });

  const isDark = variant === 'dark';
  const hasAnyVisibleErrors = progress.errorStepsCount > 0;

  const barBackgroundStyle: React.CSSProperties = progress.isReadyToSubmit
    ? { background: 'linear-gradient(90deg, #10B981, #34D399)' }
    : hasAnyVisibleErrors
    ? { background: 'linear-gradient(90deg, #F59E0B, #F43F5E)' }
    : primaryColor && accentColor
    ? { background: `linear-gradient(90deg, ${primaryColor}, ${accentColor})` }
    : { background: 'linear-gradient(90deg, #0066FF, #00B8FF)' };

  return (
    <section
      aria-label="Progreso de originación de solicitud"
      className={
        isDark
          ? 'rounded-xl border border-white/10 bg-[#030816]/65 p-3.5 sm:p-4 space-y-3.5'
          : 'axy-surface rounded-2xl p-4 sm:p-5 space-y-4'
      }
    >
      {/* Top Row: Current step position, remaining steps guidance, and tabular completion */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className={`font-mono text-xs font-bold tabular-nums ${
                progress.isReadyToSubmit
                  ? isDark
                    ? 'text-emerald-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                  : isDark
                  ? 'text-[#00D1FF]'
                  : 'text-[#0066FF] dark:text-[#00D1FF]'
              }`}
            >
              Paso {progress.currentStep} de {progress.totalSteps}
            </span>
            <span
              aria-hidden="true"
              className={isDark ? 'text-slate-600' : 'text-slate-300 dark:text-slate-600'}
            >
              ·
            </span>
            <span
              className={`text-xs sm:text-sm font-semibold ${
                isDark ? 'text-white' : 'text-slate-900 dark:text-white'
              }`}
            >
              {progress.currentStepMeta.fullLabel}
            </span>
          </div>

          <div
            className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs ${
              progress.isReadyToSubmit
                ? isDark
                  ? 'text-emerald-300'
                  : 'text-emerald-700 dark:text-emerald-400'
                : hasAnyVisibleErrors
                ? isDark
                  ? 'text-amber-300'
                  : 'text-amber-700 dark:text-amber-400'
                : isDark
                ? 'text-slate-300'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <span className="font-medium">{progress.remainingHeadline}</span>
            <span
              aria-hidden="true"
              className={isDark ? 'text-slate-600' : 'text-slate-300 dark:text-slate-600'}
            >
              ·
            </span>
            <span
              className={
                isDark ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'
              }
            >
              {progress.remainingDetail}
            </span>
          </div>
        </div>

        <div className="flex items-baseline gap-2 shrink-0 font-mono tabular-nums">
          <span
            className={`text-base sm:text-lg font-bold tracking-tight ${
              progress.isReadyToSubmit
                ? isDark
                  ? 'text-emerald-400'
                  : 'text-emerald-600 dark:text-emerald-400'
                : hasAnyVisibleErrors
                ? isDark
                  ? 'text-amber-300'
                  : 'text-amber-600 dark:text-amber-400'
                : isDark
                ? 'text-white'
                : 'text-slate-900 dark:text-white'
            }`}
          >
            {progress.progressPercent}%
          </span>
          <span
            className={`text-[11px] ${
              isDark ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            ({progress.completedValidSteps}/{progress.totalSteps})
          </span>
        </div>
      </div>

      {/* Continuous Segmented Visual Progress Track (compositor-only scaleX transform) */}
      <div
        role="progressbar"
        aria-label="Avance de la solicitud de crédito"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.progressPercent}
        aria-valuetext={`${progress.progressPercent}% — Paso ${progress.currentStep} de ${progress.totalSteps}. ${progress.remainingHeadline}`}
        className={`relative h-2 w-full overflow-hidden rounded-full ${
          isDark ? 'bg-white/10' : 'bg-slate-200/80 dark:bg-slate-800'
        }`}
      >
        <div
          className="h-full w-full origin-left rounded-full transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{
            ...barBackgroundStyle,
            transform: `scaleX(${progress.progressPercent / 100})`,
          }}
        />
        {/* Subtle 5-step segment dividers */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 grid grid-cols-5"
        >
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className={`border-r ${
                isDark
                  ? 'border-[#030816]/75'
                  : 'border-white/75 dark:border-slate-950/70'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Interactive 5-Step Milestones */}
      <nav aria-label="Pasos del formulario de solicitud" className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 sm:gap-2">
        {ORIGINATION_STEPS.map(({ step: num, shortLabel }) => {
          const status = progress.stepStatuses[num];
          const stepErrors = stepErrorCounts[num] ?? 0;
          const isCurrent = num === currentStep;
          const isError = status === 'error';
          const isComplete = status === 'complete';

          const buttonClasses = isDark
            ? isCurrent
              ? isError
                ? 'border-rose-500 bg-rose-500/15 text-rose-100'
                : 'border-[#00B8FF] bg-[#0066FF]/20 text-white'
              : isError
              ? 'border-rose-500/45 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15'
              : isComplete
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15'
              : 'border-white/10 bg-white/[0.02] text-slate-400 hover:text-slate-200 hover:border-white/20'
            : isCurrent
            ? isError
              ? 'border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              : 'border-[#0066FF] bg-[#0066FF]/[0.08] dark:bg-[#0066FF]/20 text-[#0066FF] dark:text-[#00D1FF]'
            : isError
            ? 'border-rose-400/70 bg-rose-50/70 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/45'
            : isComplete
            ? 'border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-950/25 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
            : 'border-slate-200/80 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02] text-slate-600 dark:text-slate-400 hover:bg-slate-100/70 dark:hover:bg-white/[0.05]';

          const indicatorClasses = isError
            ? 'bg-rose-600 text-white'
            : isComplete
            ? 'bg-emerald-600 text-white'
            : isCurrent
            ? isDark
              ? 'bg-[#00B8FF] text-[#030816]'
              : 'bg-[#0066FF] text-white'
            : isDark
            ? 'bg-white/10 text-slate-400'
            : 'bg-slate-200/90 dark:bg-white/10 text-slate-600 dark:text-slate-400';

          return (
            <button
              key={num}
              type="button"
              onClick={() => onSelectStep(num)}
              aria-current={isCurrent ? 'step' : undefined}
              className={`min-h-[40px] py-2 px-2.5 rounded-xl border text-left flex items-center gap-2 cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00B8FF] ${buttonClasses}`}
            >
              <span
                className={`w-5 h-5 rounded-full shrink-0 inline-flex items-center justify-center text-[10px] font-bold font-mono tabular-nums ${indicatorClasses}`}
                aria-hidden="true"
              >
                {isError ? (
                  stepErrors > 0 ? (
                    stepErrors
                  ) : (
                    <AlertCircle className="w-3 h-3" />
                  )
                ) : isComplete ? (
                  <Check className="w-3 h-3 stroke-[2.75]" />
                ) : (
                  num
                )}
              </span>
              <span
                className={`text-[11px] sm:text-xs truncate whitespace-nowrap ${
                  isCurrent ? 'font-semibold' : 'font-medium'
                }`}
              >
                {shortLabel}
              </span>
            </button>
          );
        })}
      </nav>
    </section>
  );
};
