import React from 'react';
import { History, Trash2 } from 'lucide-react';
import type { DirectorAnalysisResponse } from '../../types/axycore';
import { formatTimestamp } from '../../utils/formatters';
import { getFocusLabel, HEALTH_META } from './directorMeta';

interface DirectorHistoryDrawerProps {
  history: DirectorAnalysisResponse[];
  selectedAnalysisId?: string;
  onSelect: (analysisId: string) => void;
  onClear: () => void;
}

export const DirectorHistoryDrawer = React.memo(function DirectorHistoryDrawer({
  history,
  selectedAnalysisId,
  onSelect,
  onClear,
}: DirectorHistoryDrawerProps) {
  if (history.length === 0) return null;

  return (
    <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white flex items-center gap-2">
          <History className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
          <span>Historial de Dictámenes de AxyCore Director ({history.length})</span>
        </h3>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Limpiar historial</span>
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {history.map((item, historyIdx) => {
          const isSelected = Boolean(
            selectedAnalysisId && item.analysisId && selectedAnalysisId === item.analysisId
          );
          const hMeta =
            item.healthStatus && HEALTH_META[item.healthStatus]
              ? HEALTH_META[item.healthStatus]
              : HEALTH_META.ESTABLE;
          const historyKey = `history-${item.analysisId || item.generatedAtIso || 'entry'}-${historyIdx}`;
          return (
            <button
              key={historyKey}
              type="button"
              onClick={() => {
                if (item.analysisId) onSelect(item.analysisId);
              }}
              className={`p-3 rounded-xl border text-left transition cursor-pointer space-y-1 ${
                isSelected
                  ? 'bg-[#0066FF]/8 border-[#0066FF] dark:bg-[#00B8FF]/12 dark:border-[#00B8FF]'
                  : 'bg-slate-50 dark:bg-[#040C1E] border-slate-200 dark:border-white/10 hover:border-[#0066FF]/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className={`px-1.5 py-0.5 rounded border font-semibold ${hMeta.badgeClass}`}>
                  {getFocusLabel(item.focusMode)} · {hMeta.label}
                </span>
                <span className="font-mono text-slate-500 dark:text-slate-400">
                  {formatTimestamp(item.generatedAtIso)}
                </span>
              </div>
              <p className="text-xs font-bold text-slate-900 dark:text-white line-clamp-1">
                {item.executiveHeadline || 'Dictamen Ejecutivo'}
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2">
                {item.executiveSummary}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default DirectorHistoryDrawer;
