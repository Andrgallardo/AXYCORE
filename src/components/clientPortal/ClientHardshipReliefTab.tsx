import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  HeartHandshake,
  MessageCircle,
  Send,
  ShieldCheck,
} from 'lucide-react';
import {
  HARDSHIP_RELIEF_OPTIONS,
  type HardshipReliefOption,
  type LoanHealthAnalysis,
} from '../../engine/clientPortalHealthEngine';
import { CLIENT_SERVICE_REQUEST_STATUS_LABELS } from '../../engine/externalPortalEngine';
import {
  createClientServiceRequest,
  sendClientPortalMessage,
} from '../../services/externalPortalService';
import type {
  ClientServiceRequestRecord,
  CustomerRecord,
  LoanRecord,
  OrganizationRecord,
  UserProfile,
} from '../../types/axycore';
import { formatMoney, formatUserFacingError } from '../../utils/formatters';

interface ClientHardshipReliefTabProps {
  userProfile: UserProfile;
  organization: OrganizationRecord;
  loans: LoanRecord[];
  selectedLoan: LoanRecord | null;
  selectedLoanHealth: LoanHealthAnalysis | null;
  customer: CustomerRecord | null;
  serviceRequests: ClientServiceRequestRecord[];
  onGoToMessages: () => void;
}

const HARDSHIP_REASONS = [
  'Reducción temporal de ingresos',
  'Imprevisto médico o emergencia familiar',
  'Cambio o pérdida de empleo',
  'Disminución temporal en ventas del negocio',
  'Aumento de gastos esenciales del hogar',
  'Otro motivo personal',
];

export function ClientHardshipReliefTab({
  userProfile,
  organization,
  loans,
  selectedLoan,
  selectedLoanHealth,
  customer,
  serviceRequests,
  onGoToMessages,
}: ClientHardshipReliefTabProps) {
  const [reliefLoanId, setReliefLoanId] = useState<string>(selectedLoan?.id || loans[0]?.id || '');
  const [selectedOption, setSelectedOption] = useState<HardshipReliefOption['id']>(
    selectedLoanHealth?.isCriticalArrears ? 'REESTRUCTURACION_PLAZO' : 'ACUERDO_CUOTAS'
  );
  const [reason, setReason] = useState<string>(HARDSHIP_REASONS[0]);
  const [affordableAmount, setAffordableAmount] = useState<string>('');
  const [targetDate, setTargetDate] = useState<string>(() => {
    const next = new Date();
    next.setDate(next.getDate() + 10);
    return next.toISOString().slice(0, 10);
  });
  const [contactPhone, setContactPhone] = useState<string>(customer?.phone || '');
  const [details, setDetails] = useState<string>('');
  const [alsoNotifyChat, setAlsoNotifyChat] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const activeLoan = useMemo(
    () => loans.find((l) => l.id === reliefLoanId) || selectedLoan || loans[0] || null,
    [loans, reliefLoanId, selectedLoan]
  );

  const activeOptionMeta = useMemo(
    () => HARDSHIP_RELIEF_OPTIONS.find((o) => o.id === selectedOption) || HARDSHIP_RELIEF_OPTIONS[0],
    [selectedOption]
  );

  const hardshipHistory = useMemo(
    () =>
      serviceRequests
        .filter((r) => r.requestType === 'AYUDA_ATRASO' || r.requestType === 'ACUERDO_PRORROGA')
        .sort((a, b) => String(b.ticketNumber || '').localeCompare(String(a.ticketNumber || ''))),
    [serviceRequests]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (details.trim().length < 10) {
      setFeedback({
        type: 'err',
        text: 'Cuéntanos brevemente tu situación (al menos 10 caracteres) para que la administración evalúe la mejor opción de alivio.',
      });
      return;
    }

    const parsedAmount = affordableAmount.trim() ? Number(affordableAmount) : null;
    if (parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0)) {
      setFeedback({
        type: 'err',
        text: 'Ingresa un monto válido para la cuota que puedes asumir.',
      });
      return;
    }

    const effectiveOrgId = userProfile.organizationId || organization.id;
    const subject = `Plan de Alivio: ${activeOptionMeta.title}`.slice(0, 160);
    const composedDetails = [
      `Modalidad solicitada: ${activeOptionMeta.title}`,
      `Motivo principal: ${reason}`,
      parsedAmount !== null && activeLoan
        ? `Capacidad de pago propuesta: ${formatMoney(parsedAmount, activeLoan.currency)}`
        : null,
      targetDate ? `Fecha estimada para retomar pagos: ${targetDate}` : null,
      `Detalle del cliente: ${details.trim()}`,
    ]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 2000);

    setSubmitting(true);
    try {
      const created = await createClientServiceRequest({
        user: userProfile,
        organizationId: effectiveOrgId,
        requestType: 'AYUDA_ATRASO',
        subject,
        details: composedDetails,
        customerId: userProfile.linkedCustomerId || customer?.id || null,
        loanId: activeLoan?.id || null,
        loanNumber: activeLoan?.loanNumber || null,
        requestedAmount: parsedAmount,
        requestedDate: targetDate || null,
        contactPhone: contactPhone.trim() || customer?.phone || null,
        documentNumber: customer?.documentNumber || null,
      });

      if (alsoNotifyChat) {
        try {
          await sendClientPortalMessage({
            organizationId: effectiveOrgId,
            clientUid: userProfile.uid,
            clientEmail: userProfile.email,
            clientName: userProfile.displayName || userProfile.email,
            customerId: userProfile.linkedCustomerId || customer?.id || null,
            loanId: activeLoan?.id || null,
            loanNumber: activeLoan?.loanNumber || null,
            senderProfile: userProfile,
            senderRole: 'CLIENT',
            category: 'AYUDA_ATRASO',
            subject: `${created.ticketNumber} · ${activeOptionMeta.title}`,
            body: composedDetails,
          });
        } catch (chatErr) {
          console.warn('No se pudo espejar la solicitud de alivio en mensajería:', chatErr);
        }
      }

      setFeedback({
        type: 'ok',
        text: `Solicitud prioritaria ${created.ticketNumber} registrada en ${
          organization.tradeName || organization.name
        }. Un administrador revisará tu propuesta en menos de 24 horas laborables.`,
      });
      setDetails('');
      setAffordableAmount('');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: formatUserFacingError(err, 'No se pudo enviar tu solicitud de alivio financiero.'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-6">
      {/* Empathetic Hero Banner */}
      <div className="rounded-2xl bg-gradient-to-br from-[#08132B] via-[#0B1B3B] to-[#11244A] border border-[#00B8FF]/25 p-6 text-white shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#00D1FF]">
              <HeartHandshake className="w-4 h-4" />
              <span>Centro de Alivio Financiero · {organization.tradeName || organization.name}</span>
            </div>
            <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight">
              Si tu crédito está atrasado o atraviesas una dificultad, busquemos una salida juntos
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Comunicar tu situación a tiempo te protege de recargos crecientes y permite a la
              administración evaluar acuerdos flexibles, prórrogas temporales o reestructuración de
              cuotas adaptados a tu realidad.
            </p>
          </div>

          {selectedLoan && selectedLoanHealth && (
            <div className="rounded-xl bg-white/[0.06] border border-white/15 p-4 min-w-[250px] space-y-2 shrink-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300">
                Diagnóstico · {selectedLoan.loanNumber}
              </p>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-slate-300">Estatus actual</span>
                <span
                  className={`text-xs font-bold ${
                    selectedLoanHealth.isCriticalArrears
                      ? 'text-rose-300'
                      : selectedLoanHealth.needsHardshipAssistance
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                  }`}
                >
                  {selectedLoanHealth.healthLabel}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-slate-300">Monto vencido + mora</span>
                <span className="font-mono tabular-nums text-sm font-bold text-white">
                  {formatMoney(
                    selectedLoanHealth.overdueAmount + selectedLoanHealth.accruedLateFeeTotal,
                    selectedLoan.currency
                  )}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-slate-300">Días de atraso</span>
                <span className="font-mono tabular-nums text-xs font-semibold text-white">
                  {selectedLoanHealth.maxDaysPastDue} días
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content: 4 Relief Options + Structured Proposal Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-5">
          {/* Option Cards */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
              1. Elige la alternativa de alivio que mejor se adapte a tu situación
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {HARDSHIP_RELIEF_OPTIONS.map((opt) => {
                const active = selectedOption === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedOption(opt.id)}
                    className={`text-left p-4 rounded-2xl border transition-all cursor-pointer space-y-1.5 ${
                      active
                        ? 'bg-[#0066FF]/[0.07] dark:bg-[#0066FF]/15 border-[#0066FF] dark:border-[#00D1FF] shadow-xs'
                        : 'bg-white dark:bg-[#08132B] border-slate-200/85 dark:border-[#00B8FF]/15 hover:border-[#0066FF]/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-display text-sm font-bold text-slate-950 dark:text-white leading-snug">
                        {opt.title}
                      </p>
                      {active && (
                        <CheckCircle2 className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0 mt-0.5" />
                      )}
                    </div>
                    <p className="text-[11px] font-semibold text-[#0052CC] dark:text-[#00D1FF]">
                      {opt.subtitle}
                    </p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                      {opt.description}
                    </p>
                    <p className="pt-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                      Ideal para: {opt.recommendedFor}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Proposal Form */}
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-5 sm:p-6 space-y-4 shadow-xs"
          >
            <div className="border-b border-slate-200/80 dark:border-white/10 pb-3">
              <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
                2. Detalla tu propuesta de normalización
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Tu solicitud llega directamente al equipo de administración y cobranzas de{' '}
                {organization.tradeName || organization.name} con prioridad alta.
              </p>
            </div>

            {feedback && (
              <div
                className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                  feedback.type === 'ok'
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                    : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-200'
                }`}
              >
                {feedback.type === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1.5">
                  <p>{feedback.text}</p>
                  {feedback.type === 'ok' && (
                    <button
                      type="button"
                      onClick={onGoToMessages}
                      className="inline-flex items-center gap-1 font-semibold underline cursor-pointer"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>Ver seguimiento en Mensajes con Administración</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
              {loans.length > 0 && (
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Préstamo a evaluar
                  </label>
                  <select
                    value={activeLoan?.id || ''}
                    onChange={(e) => setReliefLoanId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                  >
                    {loans.map((loan) => (
                      <option key={loan.id} value={loan.id}>
                        {loan.loanNumber} · Saldo {formatMoney(loan.currentPrincipalBalance, loan.currency)} ({loan.status})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Motivo de la dificultad
                </label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                >
                  {HARDSHIP_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Monto que puedes pagar cómodamente ({activeLoan?.currency || 'DOP'})
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={affordableAmount}
                  onChange={(e) => setAffordableAmount(e.target.value)}
                  placeholder="Ej. 4500"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Fecha propuesta para iniciar el acuerdo
                </label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Teléfono de contacto preferido (WhatsApp / Llamada)
                </label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="Ej. 809-555-0100"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Cuéntanos cómo podemos ayudarte mejor
                </label>
                <textarea
                  rows={4}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Explica brevemente tu situación actual, qué plan de pagos podrías cumplir sin fallar y el mejor horario para contactarte..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white resize-y"
                />
              </div>
            </div>

            <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={alsoNotifyChat}
                onChange={(e) => setAlsoNotifyChat(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-[#0066FF] focus:ring-[#0066FF]"
              />
              <span>
                Enviar también una copia directa al chat con los administradores de{' '}
                <strong>{organization.tradeName || organization.name}</strong> para agilizar la
                conversación.
              </span>
            </label>

            <div className="pt-1 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Confidencial · Atención prioritaria en menos de 24 horas laborables</span>
              </p>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shadow-sm disabled:opacity-55 transition-all"
              >
                <Send className="w-4 h-4" />
                <span>{submitting ? 'Enviando solicitud...' : 'Enviar Solicitud de Alivio'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Hardship Relief Requests History */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-5 space-y-4 shadow-xs">
            <div className="border-b border-slate-200/80 dark:border-white/10 pb-3">
              <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
                Seguimiento de Planes de Alivio ({hardshipHistory.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Respuestas oficiales de la administración sobre tus acuerdos y prórrogas.
              </p>
            </div>

            {hardshipHistory.length === 0 ? (
              <div className="p-6 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/70 dark:border-white/10 text-center space-y-2">
                <HeartHandshake className="w-7 h-7 mx-auto text-slate-400" />
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Aún no has enviado solicitudes de alivio
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Cuando envíes una propuesta, verás aquí su número de ticket, estado en tiempo real
                  y la resolución oficial de la institución.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
                {hardshipHistory.map((req) => (
                  <div
                    key={req.id}
                    className="rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10 p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold text-[#0066FF] dark:text-[#00D1FF]">
                        {req.ticketNumber}
                        {req.loanNumber ? ` · ${req.loanNumber}` : ''}
                      </span>
                      <span
                        className={`text-[11px] font-semibold ${
                          req.status === 'COMPLETADA'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : req.status === 'RECHAZADA'
                            ? 'text-rose-600 dark:text-rose-400'
                            : req.status === 'EN_PROCESO'
                            ? 'text-[#0066FF] dark:text-[#00D1FF]'
                            : 'text-amber-600 dark:text-[#E2B35E]'
                        }`}
                      >
                        {CLIENT_SERVICE_REQUEST_STATUS_LABELS[req.status] || req.status}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">{req.subject}</p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                      {req.details}
                    </p>
                    {req.staffResponse && (
                      <div className="mt-2 pt-2.5 border-t border-slate-200/80 dark:border-white/10 space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                          Respuesta Oficial · {req.resolvedByName || 'Administración'}
                        </p>
                        <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
                          {req.staffResponse}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
