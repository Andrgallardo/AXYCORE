import React, { useEffect, useState } from 'react';
import { Bell, Fingerprint, Lock, ScanFace, Sliders, X } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { ThemeSwitchControl } from './ThemeSwitchControl';

interface UserSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function UserSettingsModal({ open, onClose }: UserSettingsModalProps) {
  const {
    userProfile,
    organization,
    rbac,
    desktopNotifEnabled,
    desktopNotifPermission,
    toggleDesktopNotifications,
    biometricSupported,
    biometricLabel,
    biometricEnrolled,
    enrollBiometrics,
    lockWithBiometrics,
    disableBiometrics,
  } = useAxyCore();

  const [bioMessage, setBioMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const initials = (userProfile?.displayName || userProfile?.email || 'AX')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <div
      className="fixed inset-0 z-50 bg-[#030816]/65 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-settings-title"
        onClick={(e) => e.stopPropagation()}
        className="axy-panel-in w-full max-w-xl rounded-2xl bg-[#f4f7fc] dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/25 shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 bg-white dark:bg-[#08132B] border-b border-slate-200 dark:border-[#00B8FF]/15 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-xl axy-brand-gradient text-white flex items-center justify-center shrink-0">
              <Sliders className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="user-settings-title"
                className="font-display text-base font-bold text-slate-950 dark:text-white truncate"
              >
                Configuración de Usuario
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Preferencias personales de apariencia, notificaciones y seguridad
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar configuración de usuario"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Account Summary */}
          <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/15 flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-xl axy-brand-gradient text-white font-display text-sm font-bold flex items-center justify-center shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-950 dark:text-white truncate">
                {userProfile?.displayName || 'Usuario AxyCore'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {userProfile?.email}
              </p>
              <p className="text-[11px] font-mono text-[#0052CC] dark:text-[#00D1FF] mt-0.5 truncate">
                {rbac.roleLabel} · {organization.tradeName || organization.name}
              </p>
            </div>
          </div>

          {/* Persistent Light / Dark Theme Switch */}
          <ThemeSwitchControl variant="card" />

          {/* Desktop Notifications Preference */}
          <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/15 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-700 dark:text-[#00D1FF] flex items-center justify-center shrink-0">
                <Bell className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h4 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                  Alertas de Escritorio
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  {desktopNotifPermission === 'unsupported'
                    ? 'Este navegador no soporta notificaciones de escritorio.'
                    : desktopNotifPermission === 'denied'
                    ? 'Permiso bloqueado en el navegador. Habilítalo en la configuración del sitio.'
                    : 'Notificaciones instantáneas cuando cambie el estado de solicitudes o alertas críticas.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={desktopNotifEnabled}
              aria-label="Alternar alertas de escritorio"
              disabled={desktopNotifPermission === 'unsupported'}
              onClick={() => void toggleDesktopNotifications()}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00B8FF] ${
                desktopNotifEnabled
                  ? 'bg-[#0066FF] border-[#00B8FF]/70'
                  : 'bg-slate-200 border-slate-300 dark:bg-slate-700 dark:border-slate-600'
              }`}
            >
              <span
                className={`inline-block h-4.5 w-4.5 rounded-full bg-white shadow-xs transition-transform duration-150 ${
                  desktopNotifEnabled ? 'translate-x-5.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Biometric Security */}
          {biometricSupported && (
            <div className="p-4 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/15 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-[#0052CC] dark:text-[#00D1FF] flex items-center justify-center shrink-0">
                    <ScanFace className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-display text-sm font-bold text-slate-950 dark:text-white truncate">
                      Seguridad con {biometricLabel}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {biometricEnrolled
                        ? 'Vinculado en este dispositivo'
                        : 'Disponible para proteger tu sesión'}
                    </p>
                  </div>
                </div>

                {biometricEnrolled ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        lockWithBiometrics();
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#00B8FF]/25 bg-slate-50 dark:bg-[#040C1E] text-xs font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:bg-slate-100 dark:hover:bg-white/5 whitespace-nowrap cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Bloquear</span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await disableBiometrics();
                        setBioMessage(`${biometricLabel} desvinculado de este equipo.`);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 whitespace-nowrap cursor-pointer"
                    >
                      <Fingerprint className="w-3.5 h-3.5" />
                      <span>Desvincular</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      setBioMessage(null);
                      const res = await enrollBiometrics();
                      setBioMessage(
                        res.ok
                          ? `${biometricLabel} activado correctamente.`
                          : res.error || `No se pudo activar ${biometricLabel}.`
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg axy-brand-gradient text-white text-xs font-semibold hover:brightness-110 whitespace-nowrap cursor-pointer shrink-0"
                  >
                    <ScanFace className="w-3.5 h-3.5" />
                    <span>Activar</span>
                  </button>
                )}
              </div>

              {bioMessage && (
                <p className="text-xs text-slate-600 dark:text-slate-300">{bioMessage}</p>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-white dark:bg-[#08132B] border-t border-slate-200 dark:border-[#00B8FF]/15 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-[#0066FF] text-white text-xs font-semibold hover:opacity-95 cursor-pointer whitespace-nowrap"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
