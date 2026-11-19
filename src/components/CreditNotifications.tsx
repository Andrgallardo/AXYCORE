import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  NotificationCenter,
  DashboardTopAlertStrip,
  triggerOpenNotificationCenter,
  OPEN_NOTIFICATION_CENTER_EVENT,
  type OpenNotificationCenterDetail,
} from './NotificationCenter';

export {
  NotificationCenter,
  DashboardTopAlertStrip,
  triggerOpenNotificationCenter,
  OPEN_NOTIFICATION_CENTER_EVENT,
  type OpenNotificationCenterDetail,
};

export const InboxNotificationBell = NotificationCenter;

export function CreditNotificationToasts() {
  const {
    userProfile,
    liveToasts,
    dismissLiveToast,
    acknowledgeAlert,
    setActiveSection,
    setSelectedApplicationId,
  } = useAxyCore();

  useEffect(() => {
    if (liveToasts.length === 0) return;
    const timers = liveToasts.map((t) =>
      window.setTimeout(() => {
        dismissLiveToast(t.toastId);
      }, 14000)
    );
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [liveToasts, dismissLiveToast]);

  if (!userProfile || userProfile.role === 'EXTERNAL_CLIENT' || liveToasts.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed bottom-20 right-5 z-50 flex flex-col gap-2.5 w-[340px] sm:w-[390px] max-w-[calc(100vw-2rem)]"
      role="status"
      aria-live="polite"
    >
      {liveToasts.slice(0, 3).map((toast) => {
        const nextSection = toast.status === 'EN_COMITE' ? 'committee' : 'evaluation';
        return (
          <div
            key={toast.toastId}
            className="axy-panel-in p-4 rounded-2xl bg-white/95 dark:bg-[#08132B]/95 backdrop-blur-md border border-slate-200/90 dark:border-[#00B8FF]/25 shadow-[0_16px_40px_-10px_rgba(4,27,78,0.25)] dark:shadow-[0_16px_40px_-10px_rgba(0,0,0,0.75)] space-y-2 text-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-[#0066FF] dark:text-[#00B8FF]">
                  {toast.title}
                </p>
                <p className="font-medium text-slate-900 dark:text-white mt-0.5">
                  {toast.detail}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismissLiveToast(toast.toastId)}
                aria-label="Cerrar alerta"
                className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  acknowledgeAlert(toast.ackKey);
                  setSelectedApplicationId(toast.applicationId);
                  setActiveSection(nextSection);
                  dismissLiveToast(toast.toastId);
                }}
                className="px-3 py-1.5 rounded-lg axy-brand-gradient text-white text-[11px] font-medium whitespace-nowrap cursor-pointer"
              >
                {toast.status === 'EN_COMITE' ? 'Atender en Comité' : 'Evaluar Ahora'}
              </button>
              <button
                type="button"
                onClick={() => {
                  acknowledgeAlert(toast.ackKey);
                  setActiveSection('applications');
                  setSelectedApplicationId(toast.applicationId);
                  dismissLiveToast(toast.toastId);
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#00B8FF]/20 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#0E1D40] whitespace-nowrap cursor-pointer"
              >
                Abrir en Inbox
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
