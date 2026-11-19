import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';

interface ThemeSwitchControlProps {
  variant?: 'compact' | 'card';
  className?: string;
}

export function ThemeSwitchControl({
  variant = 'card',
  className = '',
}: ThemeSwitchControlProps) {
  const { darkMode, setDarkMode, toggleDarkMode } = useAxyCore();

  if (variant === 'compact') {
    return (
      <div
        className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors ${className}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {darkMode ? (
            <Moon className="w-3.5 h-3.5 text-[#00D1FF] shrink-0" />
          ) : (
            <Sun className="w-3.5 h-3.5 text-[#E2B35E] shrink-0" />
          )}
          <div className="min-w-0">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
              Tema Oscuro
            </span>
            <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {darkMode ? 'Activado · Midnight Navy' : 'Desactivado · Modo Claro'}
            </span>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={darkMode}
          aria-label="Alternar tema oscuro y claro"
          onClick={toggleDarkMode}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00B8FF] ${
            darkMode
              ? 'bg-[#0066FF] border-[#00B8FF]/60'
              : 'bg-slate-200 border-slate-300 dark:bg-slate-700 dark:border-slate-600'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform duration-150 ${
              darkMode ? 'translate-x-4.5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`p-4 sm:p-5 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-4 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 border ${
              darkMode
                ? 'bg-[#040C1E] border-[#00B8FF]/30 text-[#00D1FF]'
                : 'bg-sky-50 border-sky-200 text-[#0052CC]'
            }`}
          >
            {darkMode ? <Moon className="w-4.5 h-4.5" /> : <Sun className="w-4.5 h-4.5" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                Apariencia de la Plataforma
              </h4>
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                · {darkMode ? 'Tema Oscuro activo' : 'Tema Claro activo'}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
              Alterna entre el tema claro y oscuro. La preferencia se guarda automáticamente en{' '}
              <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                localStorage
              </span>{' '}
              para mantenerla al recargar o abrir nuevas pestañas.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
            {darkMode ? 'Oscuro' : 'Claro'}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={darkMode}
            aria-label="Interruptor de tema oscuro y claro"
            onClick={toggleDarkMode}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00B8FF] ${
              darkMode
                ? 'bg-[#0066FF] border-[#00B8FF]/70 shadow-[0_0_12px_-2px_rgba(0,184,255,0.45)]'
                : 'bg-slate-200 border-slate-300 hover:bg-slate-300/80'
            }`}
          >
            <span
              className={`inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-white shadow-xs transition-transform duration-150 ${
                darkMode ? 'translate-x-5.5' : 'translate-x-0.5'
              }`}
            >
              {darkMode ? (
                <Moon className="w-2.5 h-2.5 text-[#0052CC]" />
              ) : (
                <Sun className="w-2.5 h-2.5 text-amber-500" />
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Explicit Theme Mode Selector Buttons for one-click direct selection */}
      <div className="grid grid-cols-2 gap-2.5 pt-1">
        <button
          type="button"
          onClick={() => setDarkMode(false)}
          aria-pressed={!darkMode}
          className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
            !darkMode
              ? 'border-[#0066FF] bg-sky-50/80 dark:bg-[#0066FF]/15 text-slate-950 dark:text-white shadow-xs'
              : 'border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-[#040C1E]/60 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-[#00B8FF]/30'
          }`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <Sun
              className={`w-4 h-4 shrink-0 ${
                !darkMode ? 'text-[#0066FF]' : 'text-slate-400 dark:text-slate-500'
              }`}
            />
            <span className="text-xs font-semibold truncate">Tema Claro</span>
          </span>
          <span className="h-3.5 w-3.5 rounded-sm border border-slate-300 bg-[#f4f7fc] shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => setDarkMode(true)}
          aria-pressed={darkMode}
          className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
            darkMode
              ? 'border-[#00B8FF] bg-[#040C1E] text-white shadow-xs'
              : 'border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-[#040C1E]/60 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-[#00B8FF]/30'
          }`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <Moon
              className={`w-4 h-4 shrink-0 ${
                darkMode ? 'text-[#00D1FF]' : 'text-slate-400 dark:text-slate-500'
              }`}
            />
            <span className="text-xs font-semibold truncate">Tema Oscuro</span>
          </span>
          <span className="h-3.5 w-3.5 rounded-sm border border-[#00B8FF]/40 bg-[#08132B] shrink-0" />
        </button>
      </div>
    </div>
  );
}
