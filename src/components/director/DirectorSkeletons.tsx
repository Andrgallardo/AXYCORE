import React from 'react';

export function DirectorCommandSkeleton() {
  return (
    <div
      className="space-y-6 animate-pulse"
      aria-busy="true"
      aria-label="Cargando AxyCore Director"
    >
      <div className="relative overflow-hidden rounded-2xl bg-[#040C1E] border border-[#00B8FF]/22 p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2.5">
            <div className="h-3.5 w-52 rounded bg-[#00B8FF]/20" />
            <div className="h-7 w-64 rounded bg-white/15" />
            <div className="h-3 w-96 max-w-full rounded bg-white/10" />
          </div>
          <div className="flex gap-2">
            <div className="h-10 w-36 rounded-xl bg-white/10" />
            <div className="h-10 w-40 rounded-xl bg-[#0066FF]/35" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 pt-2 border-t border-white/10">
          {[1, 2, 3, 4, 5, 6].map((k) => (
            <div
              key={`dir-kpi-sk-${k}`}
              className="h-20 rounded-xl bg-[#071430]/95 border border-[#00B8FF]/12 p-3 space-y-2"
            >
              <div className="h-2.5 w-20 rounded bg-white/10" />
              <div className="h-4 w-24 rounded bg-white/18" />
              <div className="h-2.5 w-16 rounded bg-white/10" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((k) => (
            <div
              key={`dir-mode-sk-${k}`}
              className="h-20 rounded-xl bg-[#071430]/80 border border-white/10 p-3 space-y-2"
            >
              <div className="h-3 w-28 rounded bg-white/15" />
              <div className="h-2.5 w-full rounded bg-white/10" />
            </div>
          ))}
        </div>
      </div>

      <DirectorBriefingSkeleton />
    </div>
  );
}

export function DirectorBriefingSkeleton() {
  return (
    <div
      className="space-y-6 animate-pulse"
      aria-busy="true"
      aria-label="Cargando dictamen ejecutivo"
    >
      <div className="p-6 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2 flex-1">
            <div className="h-4 w-48 rounded bg-slate-200 dark:bg-white/12" />
            <div className="h-6 w-80 max-w-full rounded bg-slate-200/90 dark:bg-white/15" />
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-20 rounded-xl bg-slate-200 dark:bg-white/10" />
            <div className="h-8 w-28 rounded-xl bg-slate-200 dark:bg-white/10" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-3.5 w-full rounded bg-slate-100 dark:bg-white/8" />
          <div className="h-3.5 w-11/12 rounded bg-slate-100 dark:bg-white/8" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2">
          {[1, 2, 3, 4, 5, 6].map((k) => (
            <div
              key={`brief-metric-sk-${k}`}
              className="h-16 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/70 dark:border-white/10"
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 h-56 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 p-5 space-y-3">
          <div className="h-4 w-44 rounded bg-slate-200 dark:bg-white/12" />
          <div className="h-20 rounded-xl bg-slate-100 dark:bg-[#040C1E]" />
          <div className="h-20 rounded-xl bg-slate-100 dark:bg-[#040C1E]" />
        </div>
        <div className="lg:col-span-5 h-56 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/15 p-5 space-y-3">
          <div className="h-4 w-40 rounded bg-slate-200 dark:bg-white/12" />
          <div className="h-36 rounded-xl bg-slate-100 dark:bg-[#040C1E]" />
        </div>
      </div>
    </div>
  );
}

export function DirectorHistorySkeleton() {
  return (
    <div
      className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-3 animate-pulse"
      aria-busy="true"
      aria-label="Cargando historial de dictámenes"
    >
      <div className="h-4 w-56 rounded bg-slate-200 dark:bg-white/12" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {[1, 2, 3].map((k) => (
          <div
            key={`hist-sk-${k}`}
            className="h-24 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200/70 dark:border-white/10"
          />
        ))}
      </div>
    </div>
  );
}

export function DashboardSectionSkeleton({
  heightClass = 'h-64',
  columns = 2,
}: {
  heightClass?: string;
  columns?: 1 | 2 | 3;
}) {
  const gridCols =
    columns === 1
      ? 'grid-cols-1'
      : columns === 3
      ? 'grid-cols-1 md:grid-cols-3'
      : 'grid-cols-1 lg:grid-cols-2';

  return (
    <div
      className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/16 p-5 sm:p-6 space-y-4 animate-pulse"
      aria-busy="true"
      aria-label="Cargando bloque del tablero"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="h-4 w-48 rounded bg-slate-200 dark:bg-white/12" />
          <div className="h-3 w-72 max-w-full rounded bg-slate-100 dark:bg-white/8" />
        </div>
        <div className="h-8 w-28 rounded-xl bg-slate-100 dark:bg-white/8" />
      </div>
      <div className={`grid ${gridCols} gap-4`}>
        {Array.from({ length: columns }).map((_, idx) => (
          <div
            key={`dash-sk-${idx}`}
            className={`${heightClass} rounded-xl bg-slate-100/80 dark:bg-[#040C1E]/75 border border-slate-200/60 dark:border-white/8`}
          />
        ))}
      </div>
    </div>
  );
}
