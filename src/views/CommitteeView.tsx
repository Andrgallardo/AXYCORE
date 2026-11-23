import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Gavel, RefreshCw, ShieldAlert, UserCheck, Users } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { generateId, submitCommitteeDecision } from '../services/axycoreStore';
import { evaluateCollegialCommitteeVotes, type CollegialVoteEntry } from '../engine/workflowGuards';
import {
  calculateRenewalNetDisbursement,
  computeRenewalPayoffBreakdown,
} from '../engine/renewalEngine';
import {
  APPLICATION_STATUS_LABELS,
  PRODUCT_LABELS,
  RENEWAL_MODALITY_LABELS,
  formatMoney,
  formatRatePct,
  normalizeMonthlyRateDecimal,
  toIsoDateOnly,
} from '../utils/formatters';
import { ROLE_LABELS, type CommitteeDecisionRecord } from '../types/axycore';

export function CommitteeView() {
  const {
    applications,
    customers,
    loans,
    loanInstallments,
    payments,
    collectionAccounts,
    creditRenewals,
    evaluations,
    committeeDecisions,
    activeOrTestPolicy,
    activeCollectionPolicy,
    userProfile,
    usersList,
    organizationMemberships,
    selectedApplicationId,
    setSelectedApplicationId,
    setActiveSection,
    rbac,
  } = useAxyCore();

  const committeeInbox = useMemo(
    () => applications.filter((a) => ['EN_COMITE', 'EN_EVALUACION'].includes(a.status)),
    [applications]
  );

  const activeApp = useMemo(() => {
    if (selectedApplicationId) {
      const found = committeeInbox.find((a) => a.id === selectedApplicationId);
      if (found) return found;
    }
    return committeeInbox[0] ?? null;
  }, [committeeInbox, selectedApplicationId]);

  const activeEval = useMemo(
    () => (activeApp ? evaluations.find((e) => e.applicationId === activeApp.id) ?? null : null),
    [activeApp, evaluations]
  );

  const registeredVoters = useMemo(() => {
    if (!activeApp) return [];
    const byIdentity = new Map<string, { id: string; name: string; email: string; role: string }>();

    usersList
      .filter(
        (u) =>
          u.organizationId === activeApp.organizationId &&
          u.status === 'ACTIVE' &&
          (u.role === 'COMMITTEE_MEMBER' || u.role === 'ADMIN')
      )
      .forEach((u) => {
        const key = (u.email || u.uid).toLowerCase();
        byIdentity.set(key, {
          id: u.uid,
          name: u.displayName || u.email,
          email: u.email,
          role: u.role,
        });
      });

    organizationMemberships
      .filter(
        (m) =>
          m.organizationId === activeApp.organizationId &&
          m.status === 'ACTIVE' &&
          (m.role === 'COMMITTEE_MEMBER' || m.role === 'ADMIN')
      )
      .forEach((m) => {
        const key = (m.userEmail || m.userId).toLowerCase();
        if (!byIdentity.has(key)) {
          byIdentity.set(key, {
            id: m.userId,
            name: m.userDisplayName || m.userEmail,
            email: m.userEmail,
            role: m.role,
          });
        }
      });

    return Array.from(byIdentity.values());
  }, [activeApp, usersList, organizationMemberships]);

  const appVotes = useMemo<CollegialVoteEntry[]>(() => {
    if (!activeApp) return [];
    const docs = committeeDecisions.filter((d) => d.applicationId === activeApp.id);
    const entries: CollegialVoteEntry[] = [];
    for (const d of docs) {
      if (d.voteStatus === 'RESOLUCION_FINAL' && Array.isArray(d.collegialVotes)) {
        d.collegialVotes.forEach((v) => entries.push(v));
      } else {
        entries.push({
          userId: d.decidedBy,
          userName: d.decidedByName,
          role: d.decidedByRole,
          vote: d.decision,
          votedAt: typeof d.decidedAt === 'string' ? d.decidedAt : '',
        });
      }
    }
    return entries;
  }, [activeApp, committeeDecisions]);

  const voteEval = useMemo(() => evaluateCollegialCommitteeVotes(appVotes, 2, 3), [appVotes]);
  const userAlreadyVoted = Boolean(userProfile && voteEval.hasUserVoted(userProfile.uid));

  const [decision, setDecision] = useState<CommitteeDecisionRecord['decision']>('APROBADO');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [approvedRatePct, setApprovedRatePct] = useState('');
  const [approvedTerm, setApprovedTerm] = useState('');
  const [conditionsRaw, setConditionsRaw] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [observations, setObservations] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
    movedToFormalization?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!activeApp) return;
    setDecision('APROBADO');
    setApprovedAmount(
      String(activeEval?.recommendedAmount ?? activeApp.recommendedAmount ?? activeApp.requestedAmount)
    );
    const rate = normalizeMonthlyRateDecimal(
      activeEval?.recommendedRateMonthly ?? activeApp.recommendedRateMonthly,
      0.04
    );
    setApprovedRatePct((rate * 100).toFixed(2));
    setApprovedTerm(
      String(activeEval?.recommendedTermMonths ?? activeApp.recommendedTermMonths ?? activeApp.requestedTermMonths)
    );
    setConditionsRaw(activeEval?.recommendedConditions ?? '');
    setRejectionReason('');
    setObservations('');
  }, [activeApp?.id, activeEval?.id]);

  const authorityCheck = useMemo(() => {
    if (!activeApp || !userProfile) return null;
    return rbac.getWorkflowAccess({
      application: activeApp,
      evaluation: activeEval,
      proposedAmount: Number(approvedAmount) || activeApp.requestedAmount,
    }).canDecideCommittee;
  }, [activeApp, activeEval, userProfile, approvedAmount, rbac]);

  const renewalCommitteeInfo = useMemo(() => {
    if (!activeApp?.isRenewal) return null;
    const renewal =
      creditRenewals.find(
        (r) => r.id === activeApp.renewalId || r.applicationId === activeApp.id
      ) ?? null;
    const originLoan =
      loans.find((l) => l.id === (activeApp.originLoanId || renewal?.originLoanId)) ?? null;
    const customer = customers.find((c) => c.id === activeApp.customerId) ?? null;
    const livePayoff = originLoan
      ? computeRenewalPayoffBreakdown({
          loan: originLoan,
          installments: loanInstallments.filter((i) => i.loanId === originLoan.id),
          payments: payments.filter((p) => p.loanId === originLoan.id),
          customer,
          account: collectionAccounts.find((a) => a.loanId === originLoan.id) ?? null,
          policy: activeCollectionPolicy,
          asOfDateIso: toIsoDateOnly(),
        }).breakdown
      : activeApp.originPayoffSnapshot ?? renewal?.payoffSnapshot ?? null;
    const parsedAmt = Number(approvedAmount) || activeApp.recommendedAmount || activeApp.requestedAmount;
    const netCheck = calculateRenewalNetDisbursement({
      grossApprovedAmount: parsedAmt,
      payoffAmount: livePayoff?.totalPayoffAmount ?? 0,
      otherAuthorizedDiscounts: 0,
    });
    return { renewal, originLoan, livePayoff, netCheck };
  }, [
    activeApp,
    creditRenewals,
    loans,
    customers,
    loanInstallments,
    payments,
    collectionAccounts,
    activeCollectionPolicy,
    approvedAmount,
  ]);

  const renewalApprovalBlocked = Boolean(
    activeApp?.isRenewal &&
      ['APROBADO', 'APROBADO_CONDICIONADO'].includes(decision) &&
      renewalCommitteeInfo &&
      !renewalCommitteeInfo.netCheck.valid
  );

  const handleSubmitDecision = async () => {
    if (!activeApp || !userProfile) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const conditionsList = conditionsRaw
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((text) => ({ text, fulfilled: false }));

      const voterName =
        (userProfile.displayName || userProfile.email || 'Miembro de Comité').trim().slice(0, 160);
      const parsedAmount = Number(approvedAmount);
      const parsedRatePct = Number(approvedRatePct);
      const parsedTerm = Number(approvedTerm);
      const isApproval = ['APROBADO', 'APROBADO_CONDICIONADO'].includes(decision);

      const result = await submitCommitteeDecision({
        application: activeApp,
        evaluation: activeEval,
        policy: activeOrTestPolicy,
        user: {
          ...userProfile,
          displayName: voterName,
        },
        decisionInput: {
          id: generateId('dec'),
          organizationId: activeApp.organizationId,
          applicationId: activeApp.id,
          decision,
          approvedAmount: isApproval
            ? Number.isFinite(parsedAmount) && parsedAmount > 0
              ? parsedAmount
              : activeEval?.recommendedAmount ?? activeApp.recommendedAmount ?? activeApp.requestedAmount
            : null,
          approvedRateMonthly: isApproval
            ? Number.isFinite(parsedRatePct) && parsedRatePct >= 0
              ? parsedRatePct / 100
              : normalizeMonthlyRateDecimal(
                  activeEval?.recommendedRateMonthly ?? activeApp.recommendedRateMonthly,
                  0.04
                )
            : null,
          approvedTermMonths: isApproval
            ? Number.isFinite(parsedTerm) && parsedTerm >= 1
              ? Math.round(parsedTerm)
              : activeEval?.recommendedTermMonths ??
                activeApp.recommendedTermMonths ??
                activeApp.requestedTermMonths
            : null,
          approvedFrequency: activeApp.paymentFrequency || 'MENSUAL',
          approvedAmortizationMethod: activeApp.amortizationMethod || 'SALDO_INSOLUTO',
          conditions: conditionsList,
          conditionsFulfilled: decision === 'APROBADO' || conditionsList.length === 0,
          rejectionReason: decision === 'RECHAZADO' ? rejectionReason.trim() : null,
          observations: observations.trim(),
          collegialVotes: [
            {
              userId: userProfile.uid,
              userName: voterName,
              role: userProfile.role,
              vote: decision,
              votedAt: new Date().toISOString(),
            },
          ],
          decidedBy: userProfile.uid,
          decidedByName: voterName,
          decidedByRole: userProfile.role,
        },
      });

      if (result.resolved) {
        const isApproved =
          result.resolvedDecision === 'APROBADO' ||
          result.resolvedDecision === 'APROBADO_CONDICIONADO';
        setFeedback({
          type: 'ok',
          movedToFormalization: isApproved,
          msg: isApproved
            ? `Quórum 2/3 alcanzado (${result.approveCount}/3 aprobaciones) para ${activeApp.applicationNumber}. Pasó automáticamente a Formalización con Pagaré, Contrato y correo con Tabla de Amortización enviados al cliente.`
            : `Resolución colegiada emitida (${result.voteCount}/3 votos): ${result.resolvedDecision} para ${activeApp.applicationNumber}.`,
        });
      } else {
        setFeedback({
          type: 'ok',
          msg: `Voto ${result.voteCount}/3 registrado para ${activeApp.applicationNumber} (${result.approveCount}/2 aprobaciones requeridas). Se requiere otro votante autorizado para completar el quórum.`,
        });
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error registrando decisión de comité.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            Comité de Crédito y Votación Colegiada (2 de 3)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Con 2 votos favorables de 3 miembros autorizados de la empresa, el crédito pasa automáticamente a Formalización y genera Pagaré, Contrato y correo con Tabla de Amortización.
          </p>
        </div>
      </div>

      {committeeInbox.length === 0 ? (
        <div className="axy-surface p-8 rounded-2xl text-center space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No hay expedientes pendientes de decisión en Comité.
          </p>
          <button
            type="button"
            onClick={() => setActiveSection('evaluation')}
            className="axy-btn-primary px-4 py-2 text-xs cursor-pointer"
          >
            Ir a Evaluación de Créditos
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-2">
            {committeeInbox.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => setSelectedApplicationId(app.id)}
                className={`w-full text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                  activeApp?.id === app.id
                    ? 'border-[#0066FF] bg-[#0066FF]/[0.06] dark:bg-[#0066FF]/16 dark:border-[#00B8FF]'
                    : 'axy-surface hover:bg-slate-50/90 dark:hover:bg-[#0E1D40]/70'
                }`}
              >
                <div className="flex justify-between text-xs font-mono text-slate-500">
                  <span>{app.applicationNumber}</span>
                  <span>Score {app.latestScore ?? '—'}</span>
                </div>
                <p className="font-semibold text-sm text-slate-950 dark:text-white mt-1 truncate">{app.applicantDisplayName}</p>
                {app.isRenewal && (
                  <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" />
                    <span>
                      Renovación ({app.renewalModality === 'MISMAS_CONDICIONES' ? 'Mismas Cond. · Directo' : 'Aumento/Modif.'})
                    </span>
                  </p>
                )}
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>{PRODUCT_LABELS[app.productCode]}</span>
                  <span>{APPLICATION_STATUS_LABELS[app.status]}</span>
                </div>
              </button>
            ))}
          </div>

          {activeApp && (
            <div className="lg:col-span-8 space-y-5">
              {activeApp.isRenewal && renewalCommitteeInfo && (
                <div className="axy-surface p-4 rounded-2xl border border-emerald-500/35 bg-emerald-500/[0.05] space-y-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-display font-bold text-sm text-slate-950 dark:text-white">
                      <RefreshCw className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>
                        Renovación {renewalCommitteeInfo.renewal?.renewalNumber || activeApp.applicationNumber} · Préstamo Origen {activeApp.originLoanNumber}
                      </span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-md bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold text-[11px]">
                      {activeApp.renewalModality
                        ? RENEWAL_MODALITY_LABELS[activeApp.renewalModality]
                        : 'Renovación'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 font-mono tabular-nums">
                    <div className="axy-surface-tonal p-2.5 rounded-xl">
                      <span className="block font-sans text-[10px] text-slate-500">Monto Nuevo Propuesto</span>
                      <strong className="text-slate-950 dark:text-white">
                        {formatMoney(renewalCommitteeInfo.netCheck.grossApprovedAmount, activeApp.currency)}
                      </strong>
                    </div>
                    <div className="axy-surface-tonal p-2.5 rounded-xl">
                      <span className="block font-sans text-[10px] text-slate-500">Saldo Liquidación Vigente</span>
                      <strong className="text-amber-600 dark:text-amber-400">
                        -{formatMoney(renewalCommitteeInfo.netCheck.payoffAmount, activeApp.currency)}
                      </strong>
                    </div>
                    <div
                      className={`p-2.5 rounded-xl border ${
                        renewalCommitteeInfo.netCheck.valid
                          ? 'bg-emerald-500/10 border-emerald-500/30'
                          : 'bg-rose-500/10 border-rose-500/40'
                      }`}
                    >
                      <span className="block font-sans text-[10px] text-slate-600 dark:text-slate-300">
                        Desembolso Neto Proyectado
                      </span>
                      <strong
                        className={
                          renewalCommitteeInfo.netCheck.valid
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-rose-700 dark:text-rose-300'
                        }
                      >
                        {formatMoney(renewalCommitteeInfo.netCheck.netDisbursementAmount, activeApp.currency)}
                      </strong>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    <strong>Regla crítica:</strong> Aprobar esta renovación en Comité <strong>NO cancela</strong> el préstamo anterior ({activeApp.originLoanNumber}). La liquidación total y cierre del crédito previo se ejecutan atómicamente solo al confirmar el desembolso.
                  </p>
                  {renewalApprovalBlocked && (
                    <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-700 dark:text-rose-300 font-semibold">
                      {renewalCommitteeInfo.netCheck.reason}
                    </div>
                  )}
                </div>
              )}
              {feedback && (
                <div
                  className={`p-3.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 overflow-hidden ${
                    feedback.type === 'ok'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
                  }`}
                >
                  <span className="min-w-0 flex-1 break-words">{feedback.msg}</span>
                  {feedback.movedToFormalization && (
                    <button
                      type="button"
                      onClick={() => setActiveSection('formalization')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                    >
                      Ir a Formalización
                    </button>
                  )}
                </div>
              )}

              {/* Panel de Votación Colegiada 2 de 3 */}
              <div className="axy-surface p-5 rounded-2xl space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                    <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                      Votación Colegiada (2 de 3 votos requeridos para Formalización Automática)
                    </h3>
                  </div>
                  <span className="font-mono font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                    {registeredVoters.length}/3 votantes registrados
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300">
                    <span>
                      Progreso de votos: <strong>{voteEval.totalVotes}/3</strong> emitidos ·{' '}
                      <strong className="text-emerald-600 dark:text-emerald-400">
                        {voteEval.approveCount}/2
                      </strong>{' '}
                      aprobaciones necesarias
                    </span>
                    <span>
                      Rechazos: {voteEval.rejectCount}/2 · Devoluciones: {voteEval.returnCount}/2
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-[#040C1E] overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#0066FF] to-[#00B8FF] transition-all"
                      style={{
                        width: `${Math.min(100, Math.round((voteEval.approveCount / 2) * 100))}%`,
                      }}
                    />
                  </div>
                </div>

                {registeredVoters.length < 3 && (
                  <div className="p-3 rounded-xl border border-amber-300/70 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300">
                    Esta empresa tiene {registeredVoters.length} de 3 votantes autorizados activos. El Administrador Global de AxyCore puede completar los 3 miembros de Comité en Platform Control.
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="axy-surface-tonal p-3.5 rounded-xl space-y-2">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      Votos Emitidos en este Expediente ({voteEval.totalVotes})
                    </p>
                    {voteEval.uniqueVotes.length === 0 ? (
                      <p className="text-slate-500">Aún no se han emitido votos para esta solicitud.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {voteEval.uniqueVotes.map((v) => (
                          <li
                            key={v.userId}
                            className="axy-surface flex items-center justify-between gap-2 p-2 rounded-lg"
                          >
                            <div>
                              <span className="font-semibold text-slate-900 dark:text-white">{v.userName}</span>
                              <span className="block text-[10px] text-slate-500">
                                {ROLE_LABELS[v.role as keyof typeof ROLE_LABELS] || v.role}
                              </span>
                            </div>
                            <span
                              className={`font-mono font-bold px-2 py-0.5 rounded ${
                                v.vote === 'APROBADO' || v.vote === 'APROBADO_CONDICIONADO'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                  : v.vote === 'RECHAZADO'
                                  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400'
                                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {v.vote}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="axy-surface-tonal p-3.5 rounded-xl space-y-2">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      Miembros Autorizados de la Empresa ({registeredVoters.length})
                    </p>
                    {registeredVoters.length === 0 ? (
                      <p className="text-slate-500">Sin miembros registrados para esta empresa.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {registeredVoters.map((voter) => {
                          const hasVoted = voteEval.hasUserVoted(voter.id);
                          return (
                            <li
                              key={voter.id}
                              className="axy-surface flex items-center justify-between gap-2 p-2 rounded-lg"
                            >
                              <div className="min-w-0">
                                <span className="font-semibold text-slate-900 dark:text-white block truncate">
                                  {voter.name}
                                </span>
                                <span className="text-[10px] font-mono text-slate-500 block truncate">
                                  {voter.email} · {ROLE_LABELS[voter.role as keyof typeof ROLE_LABELS] || voter.role}
                                </span>
                              </div>
                              <span
                                className={`inline-flex items-center gap-1 text-[10px] font-semibold shrink-0 ${
                                  hasVoted
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-slate-500'
                                }`}
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                                {hasVoted ? 'Votó' : 'Pendiente'}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              {/* Dossier & Analyst Summary */}
              <div className="axy-surface p-5 rounded-2xl space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                      {activeApp.applicantDisplayName}
                    </h3>
                    <p className="font-mono text-slate-500">
                      {activeApp.applicationNumber} · Solicitado: {formatMoney(activeApp.requestedAmount, activeApp.currency)} a {activeApp.requestedTermMonths} meses
                    </p>
                  </div>
                  <div className="text-right font-mono">
                    <p className="font-bold text-sm text-slate-950 dark:text-white">Motor V2: {activeApp.latestScore ?? '—'}/100 ({activeApp.latestRiskBand ?? '—'})</p>
                    <p className="text-slate-500">
                      Rec. Motor: {formatMoney(activeApp.recommendedAmount ?? 0, activeApp.currency)} · {formatRatePct(activeApp.recommendedRateMonthly)}
                    </p>
                  </div>
                </div>

                {activeEval ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="axy-surface-tonal p-3.5 rounded-xl space-y-1.5">
                      <p className="font-semibold text-slate-900 dark:text-white">
                        Informe Analítico ({activeEval.analystName}) · {activeEval.recommendedDecision}
                      </p>
                      <p className="text-slate-600 dark:text-slate-300">
                        {activeEval.technicalReport || activeEval.findings || 'Sin observaciones adicionales.'}
                      </p>
                    </div>
                    <div className="axy-surface-tonal p-3.5 rounded-xl space-y-1.5">
                      <p className="font-semibold text-slate-900 dark:text-white">
                        Depuración del Cliente y Riesgo · {activeEval.riskOpinionStatus ?? 'CONFORME'}
                      </p>
                      <p className="text-slate-600 dark:text-slate-300">
                        Referencias: {activeEval.referencesVerified ? 'OK' : 'Pend.'} · Dirección:{' '}
                        {activeEval.addressVerified ? 'OK' : 'Pend.'} · Teléfono:{' '}
                        {activeEval.phoneVerified ? 'OK' : 'Pend.'} · Redes:{' '}
                        {activeEval.socialMediaVerified ? 'OK' : 'Pend.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-amber-700 dark:text-amber-400">
                    Este expediente aún no tiene informe técnico cerrado en Evaluación.
                  </p>
                )}
              </div>

              {/* Authority Guard Banner */}
              {authorityCheck && !authorityCheck.allowed && (
                <div className="p-3.5 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{authorityCheck.reason}</span>
                </div>
              )}

              {userAlreadyVoted && (
                <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Ya emitiste tu voto para este expediente. Otro miembro autorizado del Comité de Crédito debe emitir su voto para completar el quórum (2 de 3).
                  </span>
                </div>
              )}

              {/* Decision Form */}
              <div className="axy-surface p-5 rounded-2xl space-y-4 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Gavel className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                    <h4 className="font-semibold text-sm text-slate-950 dark:text-white">Emitir Voto en Comité de Crédito</h4>
                  </div>
                  <span className="text-slate-500 dark:text-slate-400">Rol activo: {rbac.roleLabel}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block mb-1 text-slate-500">Voto / Decisión</label>
                    <select
                      disabled={!rbac.hasPermission('DECIDE_COMMITTEE') || userAlreadyVoted}
                      value={decision}
                      onChange={(e) => setDecision(e.target.value as typeof decision)}
                      className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white disabled:opacity-60"
                    >
                      <option value="APROBADO">Aprobado</option>
                      <option value="APROBADO_CONDICIONADO">Aprobado Condicionado</option>
                      <option value="DEVUELTO">Devuelto</option>
                      <option value="RECHAZADO">Rechazado</option>
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Monto Aprobado</label>
                    <input
                      type="number"
                      value={approvedAmount}
                      onChange={(e) => setApprovedAmount(e.target.value)}
                      disabled={
                        !rbac.hasPermission('DECIDE_COMMITTEE') ||
                        userAlreadyVoted ||
                        !['APROBADO', 'APROBADO_CONDICIONADO'].includes(decision)
                      }
                      className="axy-input w-full px-2.5 py-2 font-mono text-slate-900 dark:text-white disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Tasa Mensual (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={approvedRatePct}
                      onChange={(e) => setApprovedRatePct(e.target.value)}
                      disabled={
                        !rbac.hasPermission('DECIDE_COMMITTEE') ||
                        userAlreadyVoted ||
                        !['APROBADO', 'APROBADO_CONDICIONADO'].includes(decision)
                      }
                      className="axy-input w-full px-2.5 py-2 font-mono text-slate-900 dark:text-white disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Plazo (Meses)</label>
                    <input
                      type="number"
                      value={approvedTerm}
                      onChange={(e) => setApprovedTerm(e.target.value)}
                      disabled={
                        !rbac.hasPermission('DECIDE_COMMITTEE') ||
                        userAlreadyVoted ||
                        !['APROBADO', 'APROBADO_CONDICIONADO'].includes(decision)
                      }
                      className="axy-input w-full px-2.5 py-2 font-mono text-slate-900 dark:text-white disabled:opacity-60"
                    />
                  </div>
                </div>

                {decision === 'APROBADO_CONDICIONADO' && (
                  <div>
                    <label className="block mb-1 text-slate-500">
                      Requisitos / Condiciones Previas (una por línea, obligatorias antes de formalizar/desembolsar)
                    </label>
                    <textarea
                      rows={3}
                      disabled={!rbac.hasPermission('DECIDE_COMMITTEE') || userAlreadyVoted}
                      value={conditionsRaw}
                      onChange={(e) => setConditionsRaw(e.target.value)}
                      placeholder="Ej. Presentar carta de trabajo actualizada&#10;Constituir fianza solidaria"
                      className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white disabled:opacity-60"
                    />
                  </div>
                )}

                {decision === 'RECHAZADO' && (
                  <div>
                    <label className="block mb-1 text-rose-600 dark:text-rose-400">
                      Motivo Documentado del Rechazo *
                    </label>
                    <textarea
                      rows={2}
                      disabled={!rbac.hasPermission('DECIDE_COMMITTEE') || userAlreadyVoted}
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      className="axy-input w-full px-3 py-2 border-rose-300 dark:border-rose-800 text-slate-900 dark:text-white disabled:opacity-60"
                    />
                  </div>
                )}

                <div>
                  <label className="block mb-1 text-slate-500">Observaciones del Miembro de Comité</label>
                  <textarea
                    rows={2}
                    disabled={!rbac.hasPermission('DECIDE_COMMITTEE') || userAlreadyVoted}
                    value={observations}
                    onChange={(e) => setObservations(e.target.value)}
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white disabled:opacity-60"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-slate-500">
                    Facultad: {authorityCheck?.authorityUsed ?? 'Verificando'}
                  </span>
                  <button
                    type="button"
                    disabled={submitting || userAlreadyVoted || !authorityCheck?.allowed || renewalApprovalBlocked}
                    onClick={handleSubmitDecision}
                    className="axy-btn-primary px-4 py-2 cursor-pointer disabled:opacity-50"
                  >
                    {submitting
                      ? 'Registrando voto...'
                      : renewalApprovalBlocked
                      ? 'Bloqueado: Monto ≤ Liquidación'
                      : userAlreadyVoted
                      ? 'Voto ya emitido por este usuario'
                      : `Emitir Voto (${voteEval.totalVotes + 1}/3)`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Historical Committee Decisions */}
      {committeeDecisions.length > 0 && (
        <div className="axy-surface rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-[#00B8FF]/14">
            <h3 className="font-display text-sm font-semibold text-slate-950 dark:text-white">Historial de Votos y Resoluciones de Comité</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="axy-table-head text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-3 font-semibold">Solicitud</th>
                  <th className="py-2.5 px-3 font-semibold">Decisión</th>
                  <th className="py-2.5 px-3 font-semibold">Estado Voto</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Monto Aprobado</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Tasa</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Plazo</th>
                  <th className="py-2.5 px-3 font-semibold">Votante / Decisor</th>
                  <th className="py-2.5 px-3 font-semibold">Facultad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-[#00B8FF]/12">
                {committeeDecisions.map((d) => (
                  <tr key={d.id} className="axy-table-row">
                    <td className="py-2 px-3 font-mono">{d.applicationId.slice(0, 14)}</td>
                    <td className="py-2 px-3 font-semibold">{d.decision}</td>
                    <td className="py-2 px-3 font-mono text-[11px]">
                      {d.voteStatus === 'RESOLUCION_FINAL'
                        ? 'Resolución Final (2/3)'
                        : d.voteStatus === 'VOTO_PARCIAL'
                        ? 'Voto Parcial'
                        : 'Registrada'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">
                      {d.approvedAmount ? d.approvedAmount.toLocaleString() : '—'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{formatRatePct(d.approvedRateMonthly)}</td>
                    <td className="py-2 px-3 text-right font-mono">{d.approvedTermMonths ?? '—'} m</td>
                    <td className="py-2 px-3">{d.decidedByName}</td>
                    <td className="py-2 px-3 text-slate-500">{d.authorityUsed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

