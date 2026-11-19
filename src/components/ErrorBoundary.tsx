import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Ha ocurrido un error inesperado en la plataforma.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('AxyCore ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let friendlyText = this.state.errorMessage;
      try {
        const parsed = JSON.parse(this.state.errorMessage);
        if (parsed && parsed.error && parsed.operationType) {
          friendlyText = `Operación bloqueada o fallida (${parsed.operationType} en ${parsed.path ?? 'recurso'}): ${parsed.error}`;
        }
      } catch {
        // non-JSON error message
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
          <div className="max-w-lg w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-semibold">Interrupción de operación en AxyCore</h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed break-words">
              {friendlyText}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, errorMessage: '' })}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-sky-600 text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <RotateCcw className="w-4 h-4" />
              Restablecer vista
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
