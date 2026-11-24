import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';

export type FieldVisualVariant = 'surface' | 'dark';

export function getValidatedInputClass(
  baseClass: string,
  state: 'neutral' | 'error' | 'warning' | 'valid',
  variant: FieldVisualVariant = 'surface'
): string {
  if (state === 'error') {
    return variant === 'dark'
      ? `${baseClass} !border-rose-500/80 focus:!border-rose-400 ring-1 ring-rose-500/25`
      : `${baseClass} !border-rose-500 dark:!border-rose-500/80 focus:!border-rose-500 ring-1 ring-rose-500/20`;
  }
  if (state === 'warning') {
    return variant === 'dark'
      ? `${baseClass} !border-amber-400/70 focus:!border-amber-400`
      : `${baseClass} !border-amber-500/80 focus:!border-amber-500`;
  }
  if (state === 'valid') {
    return variant === 'dark'
      ? `${baseClass} !border-emerald-500/55 focus:!border-[#00B8FF]`
      : `${baseClass} !border-emerald-500/60 dark:!border-emerald-500/50 focus:!border-[#0066FF]`;
  }
  return baseClass;
}

interface FieldValidationFeedbackProps {
  id?: string;
  error?: string;
  warning?: string;
  validHint?: string;
  variant?: FieldVisualVariant;
}

export function FieldValidationFeedback({
  id,
  error,
  warning,
  validHint,
  variant = 'surface',
}: FieldValidationFeedbackProps) {
  if (error) {
    return (
      <p
        id={id}
        role="alert"
        className={`mt-1 flex items-start gap-1 text-[11px] leading-snug ${
          variant === 'dark' ? 'text-rose-300' : 'text-rose-600 dark:text-rose-400'
        }`}
      >
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span className="min-w-0 break-words">{error}</span>
      </p>
    );
  }

  if (warning) {
    return (
      <p
        id={id}
        className={`mt-1 flex items-start gap-1 text-[11px] leading-snug ${
          variant === 'dark' ? 'text-amber-300' : 'text-amber-700 dark:text-amber-400'
        }`}
      >
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span className="min-w-0 break-words">{warning}</span>
      </p>
    );
  }

  if (validHint) {
    return (
      <p
        id={id}
        className={`mt-1 flex items-center gap-1 text-[11px] leading-snug ${
          variant === 'dark' ? 'text-emerald-300/90' : 'text-emerald-700 dark:text-emerald-400'
        }`}
      >
        <CheckCircle2 className="w-3 h-3 shrink-0" />
        <span className="truncate">{validHint}</span>
      </p>
    );
  }

  return null;
}
