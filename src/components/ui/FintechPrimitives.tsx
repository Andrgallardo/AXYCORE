import React from 'react';

interface FintechPageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  aiTag?: boolean;
  actions?: React.ReactNode;
  className?: string;
}

export function FintechPageHeader({
  title,
  subtitle,
  eyebrow,
  aiTag = false,
  actions,
  className = '',
}: FintechPageHeaderProps) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1 ${className}`}
    >
      <div className="min-w-0 space-y-1">
        {eyebrow && (
          <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {aiTag && (
              <span
                aria-hidden="true"
                className="w-1.5 h-1.5 rounded-full bg-[#00B8FF] shrink-0"
              />
            )}
            <span
              className={
                aiTag
                  ? 'font-mono uppercase tracking-[0.08em] text-[#0066FF] dark:text-[#00D1FF] font-semibold'
                  : 'font-mono uppercase tracking-[0.08em]'
              }
            >
              {eyebrow}
            </span>
          </div>
        )}
        <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-950 dark:text-white tracking-tight truncate">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-3xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}

interface FintechSectionPanelProps {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  ai?: boolean;
  noPadding?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function FintechSectionPanel({
  title,
  subtitle,
  action,
  ai = false,
  noPadding = false,
  children,
  className = '',
}: FintechSectionPanelProps) {
  return (
    <section
      className={`${
        ai ? 'axy-surface-ai' : 'axy-surface'
      } rounded-2xl transition-colors ${noPadding ? 'overflow-hidden' : 'p-5'} ${className}`}
    >
      {(title || action) && (
        <div
          className={`flex flex-wrap items-start justify-between gap-3 ${
            noPadding
              ? 'px-5 py-4 border-b border-slate-200/80 dark:border-[#00B8FF]/14'
              : 'mb-4'
          }`}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="font-display text-sm sm:text-[15px] font-bold text-slate-950 dark:text-white tracking-tight">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

interface FintechMetricTileProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: 'neutral' | 'primary' | 'ai' | 'positive' | 'warning' | 'danger';
  className?: string;
}

const TONE_ICON_STYLES: Record<NonNullable<FintechMetricTileProps['tone']>, string> = {
  neutral: 'bg-slate-100 dark:bg-[#0E1D40] text-slate-600 dark:text-slate-300',
  primary: 'bg-[#0066FF]/10 dark:bg-[#0066FF]/18 text-[#0052CC] dark:text-[#00B8FF]',
  ai: 'bg-[#00B8FF]/12 dark:bg-[#00B8FF]/18 text-[#0066FF] dark:text-[#00D1FF]',
  positive: 'bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  warning: 'bg-amber-500/10 dark:bg-[#E2B35E]/15 text-amber-700 dark:text-[#E2B35E]',
  danger: 'bg-rose-500/10 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400',
};

export function FintechMetricTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  className = '',
}: FintechMetricTileProps) {
  return (
    <div
      className={`axy-surface rounded-2xl p-4 flex flex-col justify-between gap-2.5 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
          {label}
        </span>
        {Icon && (
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${TONE_ICON_STYLES[tone]}`}
          >
            <Icon className="w-3.5 h-3.5" />
          </div>
        )}
      </div>
      <div className="font-display text-lg sm:text-xl font-bold text-slate-950 dark:text-white tabular-nums truncate">
        {value}
      </div>
      {hint && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
          {hint}
        </p>
      )}
    </div>
  );
}

interface FintechEmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function FintechEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: FintechEmptyStateProps) {
  return (
    <div className="axy-surface-tonal rounded-2xl py-10 px-6 text-center space-y-2.5">
      <div className="w-10 h-10 rounded-xl bg-[#0066FF]/10 dark:bg-[#00B8FF]/15 text-[#0066FF] dark:text-[#00D1FF] flex items-center justify-center mx-auto">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
        {title}
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
        {description}
      </p>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
