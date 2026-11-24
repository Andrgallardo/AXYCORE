import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCheck,
  MessageCircle,
  Search,
  Send,
  UserRound,
} from 'lucide-react';
import {
  CLIENT_MESSAGE_CATEGORY_LABELS,
  extractTimestampMs,
  groupClientMessageThreads,
} from '../../engine/clientPortalHealthEngine';
import {
  markClientPortalMessagesRead,
  sendClientPortalMessage,
} from '../../services/externalPortalService';
import type {
  ClientPortalMessageRecord,
  OrganizationRecord,
  UserProfile,
} from '../../types/axycore';
import { formatUserFacingError } from '../../utils/formatters';

interface AdminClientMessagesPanelProps {
  messages: ClientPortalMessageRecord[];
  staffProfile: UserProfile;
  organization: OrganizationRecord;
  isReadOnlyAuditor: boolean;
}

function formatMessageTimestamp(ts: unknown): string {
  const ms = extractTimestampMs(ts);
  if (!ms) return 'Reciente';
  return new Date(ms).toLocaleString('es-DO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AdminClientMessagesPanel({
  messages,
  staffProfile,
  organization,
  isReadOnlyAuditor,
}: AdminClientMessagesPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClientUid, setSelectedClientUid] = useState<string>('');
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const threads = useMemo(() => groupClientMessageThreads(messages), [messages]);

  const filteredThreads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter(
      (t) =>
        t.clientName.toLowerCase().includes(q) ||
        t.clientEmail.toLowerCase().includes(q) ||
        (t.latestLoanNumber || '').toLowerCase().includes(q) ||
        t.latestMessage.body.toLowerCase().includes(q)
    );
  }, [threads, searchQuery]);

  const activeThread = useMemo(() => {
    if (filteredThreads.length === 0) return null;
    return filteredThreads.find((t) => t.clientUid === selectedClientUid) || filteredThreads[0];
  }, [filteredThreads, selectedClientUid]);

  // Mark unread client messages as read by staff when viewing the active thread
  useEffect(() => {
    if (!activeThread || isReadOnlyAuditor) return;
    const unreadIds = activeThread.messages
      .filter((m) => m.senderRole === 'CLIENT' && !m.readByStaff)
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      void markClientPortalMessagesRead({ messageIds: unreadIds, readerRole: 'ADMIN_STAFF' });
    }
  }, [activeThread, isReadOnlyAuditor]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeThread?.messages.length, activeThread?.clientUid]);

  const handleSendReply = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeThread || isReadOnlyAuditor) return;
    const trimmed = replyBody.trim();
    if (!trimmed) return;

    setError(null);
    setSending(true);
    try {
      await sendClientPortalMessage({
        organizationId: staffProfile.organizationId || organization.id,
        clientUid: activeThread.clientUid,
        clientEmail: activeThread.clientEmail,
        clientName: activeThread.clientName,
        customerId: activeThread.customerId ?? null,
        loanId: activeThread.latestMessage.loanId ?? null,
        loanNumber: activeThread.latestLoanNumber ?? null,
        senderProfile: staffProfile,
        senderRole: 'ADMIN_STAFF',
        category: activeThread.latestCategory,
        body: trimmed,
      });
      setReplyBody('');
    } catch (err) {
      setError(formatUserFacingError(err, 'No se pudo enviar la respuesta al cliente.'));
    } finally {
      setSending(false);
    }
  };

  if (threads.length === 0) {
    return (
      <div className="axy-surface rounded-2xl p-10 text-center space-y-2 border border-slate-200/80 dark:border-[#00B8FF]/18">
        <MessageCircle className="w-8 h-8 mx-auto text-slate-400" />
        <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
          Aún no hay mensajes directos desde el Portal de Clientes
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          Cuando un cliente autenticado escriba desde su espacio de autogestión, su conversación
          aparecerá aquí en tiempo real para que el equipo de administración responda.
        </p>
      </div>
    );
  }

  return (
    <div className="axy-surface rounded-2xl overflow-hidden border border-slate-200/80 dark:border-[#00B8FF]/18 grid grid-cols-1 lg:grid-cols-12 min-h-[540px]">
      {/* Left Threads Directory */}
      <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-white/10 bg-slate-50/70 dark:bg-[#050E22] flex flex-col">
        <div className="p-3.5 border-b border-slate-200/80 dark:border-white/10">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar cliente, correo o préstamo..."
              className="w-full pl-8 pr-3 py-2 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-200/70 dark:divide-white/[0.06]">
          {filteredThreads.map((thread) => {
            const selected = activeThread?.clientUid === thread.clientUid;
            const isHardship = thread.latestCategory === 'AYUDA_ATRASO';
            return (
              <button
                key={thread.clientUid}
                type="button"
                onClick={() => setSelectedClientUid(thread.clientUid)}
                className={`w-full text-left p-3.5 transition-colors cursor-pointer space-y-1 ${
                  selected
                    ? 'bg-[#0066FF]/10 dark:bg-[#0066FF]/20'
                    : 'hover:bg-white/80 dark:hover:bg-white/[0.03]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-xs text-slate-950 dark:text-white truncate">
                    {thread.clientName}
                  </span>
                  {thread.unreadByStaffCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-md bg-[#0066FF] text-white font-mono text-[10px] font-bold leading-none shrink-0">
                      {thread.unreadByStaffCount}
                    </span>
                  )}
                </div>
                <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                  {thread.clientEmail}
                  {thread.latestLoanNumber ? ` · ${thread.latestLoanNumber}` : ''}
                </p>
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span
                    className={`text-[10px] font-semibold ${
                      isHardship
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-[#0052CC] dark:text-[#00D1FF]'
                    }`}
                  >
                    {CLIENT_MESSAGE_CATEGORY_LABELS[thread.latestCategory] || thread.latestCategory}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {formatMessageTimestamp(thread.latestMessage.createdAt)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-1">
                  {thread.latestMessage.body}
                </p>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Right Active Conversation */}
      <div className="lg:col-span-8 flex flex-col max-h-[640px]">
        {activeThread ? (
          <>
            <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#0066FF]/10 text-[#0066FF] dark:text-[#00D1FF] flex items-center justify-center shrink-0">
                  <UserRound className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-display text-sm font-bold text-slate-950 dark:text-white truncate">
                    {activeThread.clientName}
                  </h4>
                  <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                    {activeThread.clientEmail}
                    {activeThread.latestLoanNumber ? ` · Préstamo ${activeThread.latestLoanNumber}` : ''}
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {activeThread.messages.length} mensaje(s)
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3.5 bg-slate-50/40 dark:bg-[#040C1E]/45">
              {activeThread.messages.map((msg) => {
                const isStaff = msg.senderRole === 'ADMIN_STAFF';
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isStaff ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-2 mb-1 px-1 text-[10px] text-slate-500 dark:text-slate-400">
                      <span className="font-semibold">
                        {isStaff ? `${msg.senderName} (Staff)` : msg.clientName}
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
                        isStaff
                          ? 'bg-[#0057E7] text-white rounded-br-md'
                          : 'bg-white dark:bg-[#0D1E42] border border-slate-200/85 dark:border-[#00B8FF]/20 text-slate-900 dark:text-slate-100 rounded-bl-md'
                      }`}
                    >
                      {msg.subject && (
                        <p
                          className={`font-bold text-[11px] mb-1 ${
                            isStaff ? 'text-sky-100' : 'text-[#0052CC] dark:text-[#00D1FF]'
                          }`}
                        >
                          {msg.subject}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                      <div
                        className={`mt-1.5 flex items-center justify-end gap-1.5 text-[10px] ${
                          isStaff ? 'text-sky-100/80' : 'text-slate-400'
                        }`}
                      >
                        <span>{formatMessageTimestamp(msg.createdAt)}</span>
                        {isStaff && (
                          <CheckCheck
                            className={`w-3.5 h-3.5 ${
                              msg.readByClient ? 'text-emerald-300' : 'opacity-65'
                            }`}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            <form
              onSubmit={handleSendReply}
              className="p-4 border-t border-slate-200/80 dark:border-white/10 bg-white dark:bg-[#08132B] space-y-2"
            >
              {error && (
                <div className="p-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-200 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex items-end gap-2.5">
                <textarea
                  rows={2}
                  disabled={isReadOnlyAuditor}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendReply();
                    }
                  }}
                  placeholder={
                    isReadOnlyAuditor
                      ? 'Modo auditoría (solo lectura)'
                      : `Responder a ${activeThread.clientName}... (Enter para enviar)`
                  }
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-xs text-slate-900 dark:text-white resize-none disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={isReadOnlyAuditor || sending || !replyBody.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-3 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>{sending ? 'Enviando...' : 'Responder'}</span>
                </button>
              </div>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
