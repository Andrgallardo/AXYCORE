import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCheck,
  MessageSquare,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  CLIENT_MESSAGE_CATEGORY_LABELS,
  extractTimestampMs,
} from '../../engine/clientPortalHealthEngine';
import {
  markClientPortalMessagesRead,
  sendClientPortalMessage,
} from '../../services/externalPortalService';
import { InstitutionalLogoBadge } from '../InstitutionalLogoBadge';
import type {
  ClientPortalMessageCategory,
  ClientPortalMessageRecord,
  CustomerRecord,
  LoanRecord,
  OrganizationRecord,
  UserProfile,
} from '../../types/axycore';
import { formatUserFacingError } from '../../utils/formatters';

interface ClientMessagingCenterProps {
  userProfile: UserProfile;
  organization: OrganizationRecord;
  loans: LoanRecord[];
  selectedLoan: LoanRecord | null;
  customer: CustomerRecord | null;
  messages: ClientPortalMessageRecord[];
}

const QUICK_STARTERS: Array<{
  label: string;
  category: ClientPortalMessageCategory;
  body: string;
}> = [
  {
    label: 'Confirmar último pago',
    category: 'PAGOS_Y_CUOTAS',
    body: 'Hola, reporté un comprobante de pago desde mi portal y me gustaría confirmar cuándo se verá aplicado a mi cuota.',
  },
  {
    label: 'Opciones de renovación',
    category: 'RENOVACION',
    body: 'Hola, estoy interesado en renovar mi crédito actual. ¿Podrían orientarme sobre el monto máximo y requisitos disponibles?',
  },
  {
    label: 'Apoyo por atraso',
    category: 'AYUDA_ATRASO',
    body: 'Hola, estoy pasando por una dificultad temporal con mis cuotas y deseo coordinar un acuerdo de pago o prórroga con administración.',
  },
  {
    label: 'Solicitar carta o estado',
    category: 'DOCUMENTOS',
    body: 'Hola, necesito solicitar una carta de saldo o estado de cuenta certificado de mi préstamo vigente.',
  },
];

function formatMessageTime(ts: unknown): string {
  const ms = extractTimestampMs(ts);
  if (!ms) return 'Reciente';
  const date = new Date(ms);
  return date.toLocaleString('es-DO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ClientMessagingCenter({
  userProfile,
  organization,
  loans,
  selectedLoan,
  customer,
  messages,
}: ClientMessagingCenterProps) {
  const [category, setCategory] = useState<ClientPortalMessageCategory>('CONSULTA_GENERAL');
  const [loanId, setLoanId] = useState<string>(selectedLoan?.id || '');
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const myMessages = useMemo(() => {
    return [...messages]
      .filter((m) => m.clientUid === userProfile.uid)
      .sort((a, b) => extractTimestampMs(a.createdAt) - extractTimestampMs(b.createdAt));
  }, [messages, userProfile.uid]);

  // Mark unread staff messages as read when the client views the thread
  useEffect(() => {
    const unreadIds = myMessages
      .filter((m) => m.senderRole === 'ADMIN_STAFF' && !m.readByClient)
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      markClientPortalMessagesRead({ messageIds: unreadIds, readerRole: 'CLIENT' });
    }
  }, [myMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [myMessages.length]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    const trimmed = body.trim();
    if (!trimmed) return;

    const effectiveOrgId = userProfile.organizationId || organization.id;
    const matchedLoan = loans.find((l) => l.id === loanId) || null;

    setSending(true);
    try {
      await sendClientPortalMessage({
        organizationId: effectiveOrgId,
        clientUid: userProfile.uid,
        clientEmail: userProfile.email,
        clientName: userProfile.displayName || userProfile.email,
        customerId: userProfile.linkedCustomerId || customer?.id || null,
        loanId: matchedLoan?.id || null,
        loanNumber: matchedLoan?.loanNumber || null,
        senderProfile: userProfile,
        senderRole: 'CLIENT',
        category,
        subject: subject.trim() || null,
        body: trimmed,
      });
      setBody('');
      setSubject('');
    } catch (err) {
      setError(formatUserFacingError(err, 'No se pudo enviar tu mensaje en este momento.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden shadow-xs grid grid-cols-1 lg:grid-cols-12">
      {/* Left Context & Quick Starters Rail */}
      <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-[#00B8FF]/15 p-5 bg-slate-50/75 dark:bg-[#050E22] space-y-5">
        <div className="flex items-start gap-3">
          <InstitutionalLogoBadge
            logoUrl={organization.logoUrl}
            name={organization.tradeName || organization.name}
            primaryColor={organization.primaryColor}
            accentColor={organization.accentColor}
            size="md"
          />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#0066FF] dark:text-[#00D1FF]">
              Canal Directo Oficial
            </p>
            <h3 className="font-display text-base font-bold text-slate-950 dark:text-white truncate">
              {organization.tradeName || organization.name}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Administradores y Oficiales de Cuenta
            </p>
          </div>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Tema de tu mensaje
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ClientPortalMessageCategory)}
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
            >
              {(Object.keys(CLIENT_MESSAGE_CATEGORY_LABELS) as ClientPortalMessageCategory[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {CLIENT_MESSAGE_CATEGORY_LABELS[key]}
                  </option>
                )
              )}
            </select>
          </div>

          {loans.length > 0 && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Préstamo relacionado (opcional)
              </label>
              <select
                value={loanId}
                onChange={(e) => setLoanId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
              >
                <option value="">Consulta general de cuenta</option>
                {loans.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.loanNumber} ({l.currency})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
            <span>Mensajes rápidos</span>
          </p>
          <div className="space-y-1.5">
            {QUICK_STARTERS.map((starter) => (
              <button
                key={starter.label}
                type="button"
                onClick={() => {
                  setCategory(starter.category);
                  setBody(starter.body);
                }}
                className="w-full text-left px-3 py-2 rounded-xl bg-white dark:bg-[#08132B] hover:bg-[#0066FF]/[0.06] dark:hover:bg-[#00B8FF]/10 border border-slate-200/80 dark:border-white/10 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              >
                {starter.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-200/80 dark:border-white/10 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          <span>
            Tus mensajes son privados y solo los administradores autorizados de{' '}
            <strong className="text-slate-700 dark:text-slate-200">
              {organization.tradeName || organization.name}
            </strong>{' '}
            pueden verlos y responderte.
          </span>
        </div>
      </aside>

      {/* Right Live Conversation Thread & Composer */}
      <div className="lg:col-span-8 flex flex-col min-h-[520px] max-h-[680px]">
        {/* Thread Header */}
        <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-white/10 flex items-center justify-between gap-3">
          <div>
            <h4 className="font-display text-sm font-bold text-slate-950 dark:text-white">
              Conversación con Administración
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {myMessages.length === 0
                ? 'Envía tu primer mensaje y recibe respuesta oficial aquí mismo'
                : `${myMessages.length} mensaje(s) en tu historial privado`}
            </p>
          </div>
          {organization.phone && (
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 hidden sm:inline">
              Tel. {organization.phone}
            </span>
          )}
        </div>

        {/* Message List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/40 dark:bg-[#040C1E]/50">
          {myMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[#0066FF]/10 text-[#0066FF] dark:text-[#00D1FF] flex items-center justify-center">
                <MessageSquare className="w-6 h-6" />
              </div>
              <div className="max-w-sm space-y-1">
                <p className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Buzón Directo con {organization.tradeName || organization.name}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Escribe cualquier consulta sobre cuotas, comprobantes, renovaciones o solicita
                  apoyo directo a los administradores de tu institución.
                </p>
              </div>
            </div>
          ) : (
            myMessages.map((msg) => {
              const isMine = msg.senderRole === 'CLIENT';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-2 mb-1 px-1 text-[10px] text-slate-500 dark:text-slate-400">
                    <span className="font-semibold">
                      {isMine
                        ? 'Tú'
                        : `${msg.senderName} · Administración`}
                    </span>
                    <span>·</span>
                    <span>{CLIENT_MESSAGE_CATEGORY_LABELS[msg.category] || msg.category}</span>
                    {msg.loanNumber && (
                      <>
                        <span>·</span>
                        <span className="font-mono">{msg.loanNumber}</span>
                      </>
                    )}
                  </div>

                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-xs ${
                      isMine
                        ? 'bg-[#0057E7] text-white rounded-br-md'
                        : 'bg-white dark:bg-[#0D1E42] border border-slate-200/85 dark:border-[#00B8FF]/20 text-slate-900 dark:text-slate-100 rounded-bl-md'
                    }`}
                  >
                    {msg.subject && (
                      <p
                        className={`font-bold text-[11px] mb-1 ${
                          isMine ? 'text-sky-100' : 'text-[#0052CC] dark:text-[#00D1FF]'
                        }`}
                      >
                        {msg.subject}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                    <div
                      className={`mt-2 flex items-center justify-end gap-1.5 text-[10px] ${
                        isMine ? 'text-sky-100/80' : 'text-slate-400'
                      }`}
                    >
                      <span>{formatMessageTime(msg.createdAt)}</span>
                      {isMine && (
                        <CheckCheck
                          className={`w-3.5 h-3.5 ${
                            msg.readByStaff ? 'text-emerald-300' : 'opacity-65'
                          }`}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSend}
          className="p-4 border-t border-slate-200/80 dark:border-white/10 bg-white dark:bg-[#08132B] space-y-2.5"
        >
          {error && (
            <div className="p-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={140}
            placeholder="Asunto breve (opcional)"
            className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
          />

          <div className="flex items-end gap-2.5">
            <textarea
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Escribe tu mensaje para los administradores de la institución... (Enter para enviar)"
              className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-xs text-slate-900 dark:text-white resize-none"
            />
            <button
              type="submit"
              disabled={sending || !body.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-3 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shadow-xs disabled:opacity-50 transition-all"
            >
              <Send className="w-4 h-4" />
              <span>{sending ? 'Enviando...' : 'Enviar'}</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
