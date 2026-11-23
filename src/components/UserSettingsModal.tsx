import React, { useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Fingerprint,
  Lock,
  Move,
  Pin,
  RotateCcw,
  ScanFace,
  Sliders,
  X,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { ThemeSwitchControl } from './ThemeSwitchControl';
import {
  clearSavedBelaFloatingPosition,
  getStoredBelaPreferences,
  saveBelaPreferences,
  type BelaBehaviorMode,
  type BelaDockedCorner,
  type BelaUserPreferences,
} from '../utils/belaPreferences';

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
  const [belaPrefs, setBelaPrefs] = useState<BelaUserPreferences>(() => getStoredBelaPreferences());
  const [belaResetNote, setBelaResetNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBelaPrefs(getStoredBelaPreferences());
    setBelaResetNote(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const updateBelaMode = (mode: BelaBehaviorMode) => {
    const saved = saveBelaPreferences({ ...belaPrefs, mode });
    setBelaPrefs(saved);
    setBelaResetNote(null);
  };

  const updateBelaCorner = (corner: BelaDockedCorner) => {
    const saved = saveBelaPreferences({ mode: 'docked', corner });
    setBelaPrefs(saved);
    setBelaResetNote(null);
  };

  const handleResetBelaFloatingPos = () => {
    clearSavedBelaFloatingPosition();
    setBelaResetNote('Posición de Bela restablecida a la esquina inferior derecha.');
  };

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
                Preferencias personales de apariencia, asistente Bela, notificaciones y seguridad
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

          {/* Bela Assistant Behavior Configuration (Flotante vs Anclado) */}
          {rbac.role !== 'EXTERNAL_CLIENT' && (
            <div className="p-4 sm:p-5 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 space-y-3.5">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-sky-50 dark:bg-[#040C1E] border border-sky-200 dark:border-[#00B8FF]/30 text-[#0052CC] dark:text-[#00D1FF] flex items-center justify-center shrink-0">
                  {belaPrefs.mode === 'floating' ? (
                    <Move className="w-4.5 h-4.5" />
                  ) : (
                    <Pin className="w-4.5 h-4.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                      Comportamiento del Asistente Bela
                    </h4>
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      · {belaPrefs.mode === 'floating' ? 'Modo Flotante' : 'Modo Anclado'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                    Elige si deseas mover a Bela libremente por la pantalla o mantenerla fija en una esquina.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(
                  [
                    {
                      id: 'floating' as BelaBehaviorMode,
                      title: 'Flotante',
                      subtitle: 'Libre arrastre',
                      desc: 'Arrastra el botón y la ventana de Bela a cualquier punto de la pantalla.',
                      icon: Move,
                    },
                    {
                      id: 'docked' as BelaBehaviorMode,
                      title: 'Anclado',
                      subtitle: 'Esquinas fijas',
                      desc: 'Fija a Bela en la esquina seleccionada para evitar desplazamientos accidentales.',
                      icon: Pin,
                    },
                  ] as const
                ).map((opt) => {
                  const active = belaPrefs.mode === opt.id;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => updateBelaMode(opt.id)}
                      className={`min-h-[68px] p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-[#0066FF] bg-sky-50/80 dark:bg-[#0066FF]/15 text-slate-950 dark:text-white'
                          : 'border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-[#040C1E]/60 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-[#00B8FF]/30'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 dark:text-white">
                          <Icon
                            className={`w-3.5 h-3.5 shrink-0 ${
                              active
                                ? 'text-[#0066FF] dark:text-[#00D1FF]'
                                : 'text-slate-400 dark:text-slate-500'
                            }`}
                          />
                          <span>{opt.title}</span>
                          <span className="font-normal text-slate-500 dark:text-slate-400">
                            · {opt.subtitle}
                          </span>
                        </span>
                        {active && (
                          <CheckCircle2 className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                        {opt.desc}
                      </p>
                    </button>
                  );
                })}
              </div>

              {belaPrefs.mode === 'docked' ? (
                <div className="pt-2 border-t border-slate-200/80 dark:border-white/10 space-y-2">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Esquina de anclaje
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { id: 'top-left' as BelaDockedCorner, label: 'Superior Izquierda' },
                        { id: 'top-right' as BelaDockedCorner, label: 'Superior Derecha' },
                        { id: 'bottom-left' as BelaDockedCorner, label: 'Inferior Izquierda' },
                        { id: 'bottom-right' as BelaDockedCorner, label: 'Inferior Derecha' },
                      ] as const
                    ).map((corner) => {
                      const active = belaPrefs.corner === corner.id;
                      return (
                        <button
                          key={corner.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => updateBelaCorner(corner.id)}
                          className={`min-h-[40px] px-3 py-2 rounded-xl border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            active
                              ? 'border-[#0066FF] bg-[#0066FF]/10 text-[#0052CC] dark:text-[#00D1FF]'
                              : 'border-slate-200 dark:border-white/10 bg-white dark:bg-[#040C1E]/50 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/25'
                          }`}
                        >
                          {corner.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="pt-2 border-t border-slate-200/80 dark:border-white/10 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {belaResetNote || 'La última posición arrastrada se recuerda automáticamente.'}
                  </span>
                  <button
                    type="button"
                    onClick={handleResetBelaFloatingPos}
                    className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/12 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restablecer posición</span>
                  </button>
                </div>
              )}
            </div>
          )}

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
