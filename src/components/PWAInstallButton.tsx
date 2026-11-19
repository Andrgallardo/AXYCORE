import React, { useState } from 'react';
import { Smartphone, Download, CheckCircle2, Share2, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (isInstalled) {
    if (compact) return null;
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
        <CheckCircle2 className="w-4 h-4" />
        <span>App instalada</span>
      </div>
    );
  }

  const handleInstallClick = async () => {
    setInstalling(true);
    try {
      await install();
    } finally {
      setInstalling(false);
    }
  };

  if (isInstallable) {
    if (compact) {
      return (
        <button
          type="button"
          onClick={handleInstallClick}
          disabled={installing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl axy-brand-gradient text-white text-xs font-semibold shadow-sm hover:brightness-110 transition cursor-pointer"
          title="Instalar AxyCore en tu celular o dispositivo"
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>Instalar App</span>
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={handleInstallClick}
        disabled={installing}
        className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-[#0052CC] via-[#0066FF] to-[#00B8FF] text-white text-xs font-semibold shadow-[0_8px_20px_-6px_rgba(0,102,255,0.55)] hover:brightness-110 transition cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center">
            <Smartphone className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <div className="font-bold leading-tight">Instalar AxyCore</div>
            <div className="text-[10px] text-sky-100 font-normal">Acceso móvil nativo</div>
          </div>
        </div>
        <Download className="w-3.5 h-3.5 text-white shrink-0" />
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={
            compact
              ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/10 border border-blue-600/30 text-blue-600 dark:text-blue-400 text-xs font-semibold hover:bg-blue-600/20 cursor-pointer'
              : 'w-full flex items-center justify-between px-4 py-3 rounded-xl bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 text-slate-800 dark:text-slate-200 text-xs font-semibold cursor-pointer'
          }
        >
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-left">Instalar en iPhone / iPad</span>
          </div>
          <Share2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4 animate-fadeIn">
            <div className="relative overflow-hidden w-full max-w-sm rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/25 p-6 shadow-2xl space-y-4">
              <div className="axy-infinity-line absolute top-0 left-0 right-0" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-[#0066FF]/15 text-[#0066FF] dark:text-[#00D1FF] flex items-center justify-center font-bold">
                    iOS
                  </div>
                  <h3 className="text-base font-bold text-slate-950 dark:text-white">Instalar en iPhone / iPad</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Para instalar AxyCore como aplicación nativa en tu dispositivo iOS:
              </p>
              <div className="space-y-2.5 text-xs text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-white/[0.03] p-3.5 rounded-xl border border-slate-200/80 dark:border-white/[0.06]">
                <div className="flex items-start gap-2.5">
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400">1.</span>
                  <span>Toca el botón <strong>Compartir</strong> (Share) en la barra inferior de Safari.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400">2.</span>
                  <span>Desplázate y selecciona <strong>Añadir a la pantalla de inicio</strong> (Add to Home Screen).</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Desktop or general fallback install button if installable prompt is ready later
  return (
    <button
      type="button"
      onClick={() => {
        alert('Para instalar AxyCore en tu computadora o celular, abre el menú de opciones de tu navegador (Chrome, Edge o Safari) y selecciona "Instalar aplicación" o "Añadir a la pantalla de inicio".');
      }}
      className={
        compact
          ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/[0.04] text-slate-700 dark:text-slate-300 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-white/10 cursor-pointer'
          : 'w-full flex items-center justify-between px-4 py-3 rounded-xl bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer'
      }
    >
      <div className="flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        <span>Instalar Aplicación</span>
      </div>
      <Download className="w-3.5 h-3.5 opacity-60" />
    </button>
  );
};
