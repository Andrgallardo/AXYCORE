import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Maximize2,
  MessageSquare,
  Minimize2,
  RotateCcw,
  Send,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import type { BelaActionSuggestion, BelaChatMessage } from '../types/axycore';
import belaAvatarImg from '../assets/images/bela_robot_avatar_1795011684572.jpg';

const BELA_QUICK_SUGGESTIONS: Array<{ label: string; prompt: string }> = [
  {
    label: 'Consultar cartera',
    prompt: '¿Cuál es el estado actual de la cartera activa y la distribución de morosidad por moneda?',
  },
  {
    label: 'Buscar un cliente',
    prompt: '¿Cómo puedo buscar un cliente, expediente o préstamo rápidamente en AxyCore?',
  },
  {
    label: 'Ver solicitudes pendientes',
    prompt: 'Muéstrame cuántas solicitudes están pendientes de evaluación, comité o formalización.',
  },
  {
    label: 'Consultar cobros del día',
    prompt: '¿Cuánto es el monto exigible para hoy y cuánto se ha confirmado recibido?',
  },
  {
    label: 'Explicar un indicador',
    prompt: 'Explícame la diferencia entre PAR 1, PAR 30, PAR 60 y PAR 90 en mis datos actuales.',
  },
  {
    label: 'Ayuda con el sistema',
    prompt: 'Según mi rol actual en AxyCore, ¿qué módulos y flujos principales tengo disponibles?',
  },
];

function BelaAvatar({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const dim =
    size === 'lg' ? 'h-14 w-14' : size === 'sm' ? 'h-9 w-9' : 'h-11 w-11';
  return (
    <div
      className={`${dim} rounded-xl overflow-hidden bg-[#040C1E] border border-[#00B8FF]/35 shrink-0 flex items-center justify-center`}
    >
      {!failed ? (
        <img
          src={belaAvatarImg}
          alt="Bela — Asistente Virtual Inteligente de AxyCore"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover object-[32%_center]"
        />
      ) : (
        <span className="font-display font-bold text-white text-sm">B</span>
      )}
    </div>
  );
}

function BelaMessageBubble({
  msg,
  onTriggerAction,
}: {
  msg: BelaChatMessage;
  onTriggerAction: (action: BelaActionSuggestion) => void;
}) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
          isUser
            ? 'axy-brand-gradient text-white shadow-xs'
            : msg.isError
            ? 'bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-rose-800 dark:text-rose-200'
            : 'bg-slate-100 dark:bg-[#0B1733] border border-slate-200/80 dark:border-[#00B8FF]/15 text-slate-900 dark:text-slate-100'
        }`}
      >
        <p className="whitespace-pre-line">{msg.content}</p>

        {!isUser && msg.verifiedFacts && msg.verifiedFacts.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-slate-200/80 dark:border-white/10 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Datos verificados
            </p>
            <ul className="space-y-1">
              {msg.verifiedFacts.map((fact, idx) => (
                <li key={idx} className="text-[11px] flex items-start gap-1.5 text-slate-700 dark:text-slate-300">
                  <CheckCircle2 className="w-3 h-3 text-[#00B8FF] shrink-0 mt-0.5" />
                  <span>{fact}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!isUser && msg.actions && msg.actions.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-slate-200/80 dark:border-white/10 flex flex-wrap gap-1.5">
            {msg.actions.map((act, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onTriggerAction(act)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/25 text-[11px] font-medium text-[#0066FF] dark:text-[#00B8FF] hover:bg-sky-50 dark:hover:bg-[#0E1D40] cursor-pointer transition-colors"
              >
                <span>{act.label}</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BelaChatCore({
  compact = false,
}: {
  compact?: boolean;
}) {
  const {
    belaMessages,
    belaLoading,
    sendBelaMessage,
    clearBelaHistory,
    setActiveSection,
    setBelaOpen,
    aiConfigured,
    rbac,
  } = useAxyCore();

  const [input, setInput] = useState('');
  const [pendingAction, setPendingAction] = useState<BelaActionSuggestion | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [belaMessages, belaLoading]);

  const handleSend = async (promptText?: string) => {
    const q = (promptText ?? input).trim();
    if (!q || belaLoading) return;
    if (!promptText) setInput('');
    await sendBelaMessage(q);
  };

  const handleActionClick = (act: BelaActionSuggestion) => {
    if (act.requiresConfirmation) {
      setPendingAction(act);
      return;
    }
    if (act.targetSection && rbac.canAccessSection(act.targetSection)) {
      setActiveSection(act.targetSection);
      if (compact) setBelaOpen(false);
    }
  };

  const confirmAction = () => {
    if (pendingAction?.targetSection && rbac.canAccessSection(pendingAction.targetSection)) {
      setActiveSection(pendingAction.targetSection);
      if (compact) setBelaOpen(false);
    }
    setPendingAction(null);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {!aiConfigured && (
        <div className="mx-4 mt-3 p-2.5 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Servicio de IA Gemini pendiente de clave <code className="font-mono">GEMINI_API_KEY</code> en servidor.
          </span>
        </div>
      )}

      {/* Quick Suggestions */}
      <div className="px-4 py-2.5 border-b border-slate-200/80 dark:border-white/[0.08] flex flex-wrap gap-1.5">
        {BELA_QUICK_SUGGESTIONS.slice(0, compact ? 4 : 6).map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={belaLoading}
            onClick={() => handleSend(s.prompt)}
            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.04] hover:bg-slate-100 dark:hover:bg-white/10 text-[11px] font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {belaMessages.map((m) => (
          <BelaMessageBubble key={m.id} msg={m} onTriggerAction={handleActionClick} />
        ))}
        {belaLoading && (
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <BelaAvatar size="sm" />
            <span>Bela está consultando los datos autorizados…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Explicit Confirmation Gate for sensitive navigation/action suggestions */}
      {pendingAction && (
        <div className="mx-4 mb-3 p-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-xs space-y-2">
          <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Confirmar acción asistida</p>
              <p className="text-[11px] opacity-90 mt-0.5">
                {pendingAction.confirmationNote ||
                  `¿Deseas abrir «${pendingAction.label}» para ejecutar esta operación manualmente? Bela no realiza modificaciones financieras automáticas.`}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingAction(null)}
              className="px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-700 text-[11px] font-medium cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmAction}
              className="px-3 py-1 rounded-lg axy-brand-gradient text-white text-[11px] font-semibold cursor-pointer"
            >
              Confirmar e ir
            </button>
          </div>
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="p-3 border-t border-slate-200/80 dark:border-[#00B8FF]/12 flex items-center gap-2 bg-white dark:bg-[#08132B]"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pregúntale a Bela sobre cartera, solicitudes o cobros…"
          className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 bg-slate-50 dark:bg-[#040C1E] text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-[#00B8FF] focus:outline-none"
        />
        <button
          type="button"
          onClick={clearBelaHistory}
          title="Reiniciar conversación"
          className="p-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <button
          type="submit"
          disabled={belaLoading || !input.trim()}
          className="p-2 rounded-xl axy-brand-gradient hover:brightness-110 text-white disabled:opacity-45 cursor-pointer transition-all"
          aria-label="Enviar consulta a Bela"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}

export function BelaDashboardCard() {
  const { setBelaOpen, setActiveSection } = useAxyCore();

  return (
    <section className="relative overflow-hidden rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 p-5 flex flex-col justify-between gap-4 shadow-xs w-full">
      <div className="flex items-start gap-3.5">
        <BelaAvatar size="md" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-[#0066FF] dark:text-[#00B8FF]">Asistente Virtual Inteligente</p>
          <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
            Bela
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Bela, tu asistente inteligente de AxyCore.
          </p>
        </div>
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
        Consulta cifras autorizadas en tiempo real, ubica expedientes, comprende indicadores PAR o navega directo a cualquier módulo con control RBAC.
      </p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => setBelaOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold cursor-pointer transition-all shadow-[0_6px_16px_-4px_rgba(0,102,255,0.45)]"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Conversar con Bela</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('bela')}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/20 hover:bg-slate-50 dark:hover:bg-[#0E1D40] text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
        >
          <span>Vista completa</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </section>
  );
}

export function BelaDedicatedView() {
  const { rbac, organization } = useAxyCore();

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl bg-[#040C1E] text-white p-6 border border-[#00B8FF]/20 flex flex-wrap items-center justify-between gap-4">
        <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-infinity-line" />
        <div className="flex items-center gap-4">
          <BelaAvatar size="lg" />
          <div>
            <p className="text-xs font-medium text-[#00B8FF]">Asistente Virtual de Inteligencia</p>
            <h2 className="font-display text-xl font-bold text-white">
              Bela, tu asistente inteligente de Axy<span className="text-[#00B8FF]">Core</span>.
            </h2>
            <p className="text-xs text-slate-300 mt-1">
              Operando bajo tu alcance RBAC ({rbac.roleLabel}) en {organization.name} · Modo lectura y orientación controlada
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-slate-300">
          <UserCheck className="w-4 h-4 text-[#00B8FF]" />
          <span>Confirmación humana obligatoria en acciones operativas</span>
        </div>
      </div>

      <div className="h-[580px] rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/90 dark:border-[#00B8FF]/15 overflow-hidden shadow-xs">
        <BelaChatCore compact={false} />
      </div>
    </div>
  );
}

export function BelaFloatingWidget() {
  const { belaOpen, setBelaOpen, rbac } = useAxyCore();
  const [minimized, setMinimized] = useState(false);
  const [expandedPanel, setExpandedPanel] = useState(false);

  if (rbac.role === 'EXTERNAL_CLIENT') return null;

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2">
      {belaOpen && (
        <div
          className={`axy-panel-in w-[calc(100vw-2rem)] ${
            expandedPanel ? 'sm:w-[520px]' : 'sm:w-[396px]'
          } ${
            minimized
              ? 'h-auto'
              : expandedPanel
              ? 'h-[620px] max-h-[84vh]'
              : 'h-[520px] max-h-[76vh]'
          } rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/25 shadow-2xl overflow-hidden flex flex-col transition-all duration-150`}
        >
          <div className="px-4 py-3 bg-[#040C1E] text-white flex items-center justify-between gap-3 shrink-0 border-b border-[#00B8FF]/18">
            <div className="flex items-center gap-2.5 min-w-0">
              <BelaAvatar size="sm" />
              <div className="min-w-0">
                <p className="font-display text-xs font-bold text-white truncate">
                  Bela · Axy<span className="text-[#00B8FF]">Core</span>
                </p>
                <p className="text-[11px] text-slate-300 truncate">
                  Asistente virtual inteligente
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setMinimized(false);
                  setExpandedPanel((v) => !v);
                }}
                title={expandedPanel ? 'Tamaño compacto' : 'Ampliar ventana en esquina'}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setMinimized((m) => !m)}
                title={minimized ? 'Restaurar chat' : 'Minimizar chat'}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setBelaOpen(false)}
                title="Cerrar ventana"
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {!minimized && <BelaChatCore compact={!expandedPanel} />}
        </div>
      )}

      {!belaOpen && (
        <button
          type="button"
          onClick={() => {
            setMinimized(false);
            setBelaOpen(true);
          }}
          className="group inline-flex items-center gap-2.5 pl-2 pr-4 py-2 rounded-2xl bg-[#040C1E] hover:bg-[#071430] text-white border border-[#00B8FF]/35 shadow-[0_14px_34px_-8px_rgba(0,102,255,0.52)] transition-all cursor-pointer"
          aria-label="Abrir asistente virtual Bela"
        >
          <BelaAvatar size="sm" />
          <div className="text-left">
            <span className="font-display text-xs font-bold block leading-tight text-white">
              Bela
            </span>
            <span className="text-[11px] text-[#00D1FF] block leading-tight">
              Asistente IA
            </span>
          </div>
        </button>
      )}
    </div>
  );
}
