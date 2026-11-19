import React, { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [showAlert, setShowAlert] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowAlert(true);
      const timer = setTimeout(() => setShowAlert(false), 4000);
      return () => clearTimeout(timer);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setShowAlert(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline && !showAlert) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[#040C1E]/95 backdrop-blur-md border border-[#00B8FF]/25 text-white shadow-2xl axy-panel-in">
      {isOnline ? (
        <>
          <div className="w-6 h-6 rounded-lg bg-[#00B8FF]/20 text-[#00D1FF] flex items-center justify-center">
            <Wifi className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-medium">Conexión restablecida en línea.</span>
        </>
      ) : (
        <>
          <div className="w-6 h-6 rounded-lg bg-[#E2B35E]/20 text-[#E2B35E] flex items-center justify-center">
            <WifiOff className="w-3.5 h-3.5" />
          </div>
          <div className="text-xs">
            <span className="font-bold block">Sin conexión a Internet</span>
            <span className="text-[10px] text-slate-400">Modo offline activo con datos cacheados.</span>
          </div>
        </>
      )}
    </div>
  );
};
