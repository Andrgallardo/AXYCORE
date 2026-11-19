import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Eye,
  Handshake,
  ListChecks,
  PhoneCall,
  Plus,
  RefreshCw,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import { getSantoDomingoTodayIso } from '../../engine/collections/delinquencyEngine';
import {
  classifyAgreementsForManagement,
  validateContactPermission,
} from '../../engine/collections/promisesAndActionsEngine';
import {
  correctClosedCollectionAction,
  createManualCollectionTask,
  decidePaymentAgreement,
  proposePaymentAgreement,
  recordCollectionAction,
  updateCollectionTaskStatus,
  updatePaymentAgreementManagementStatus,
} from '../../services/collectionsStore';
import type {
  CollectionAccountRecord,
  CollectionChannel,
  CollectionContactResult,
  CollectionPriority,
  CollectionTaskStatus,
  PaymentAgreementRecord,
} from '../../types/axycore';
import { formatMoney, formatTimestamp } from '../../utils/formatters';
import { PaymentAgreementModal } from './PaymentAgreementModal';

export function CollectionsActionsAndAgendaView({
  mode,
}: {
  mode:
    | 'my_actions'
    | 'all_actions'
    | 'agreements_today'
    | 'agreements_broken'
    | 'promises'
    | 'agenda';
}) {
  const {
    userProfile,
    collectionAccounts,
    collectionActions,
    collectionTasks,
    paymentPromises,
    paymentAgreements,
    payments,
    customerDisputes,
    messageEvents,
    activeCollectionPolicy,
    setSelectedCollectionLoanId,
    setActiveSection,
    runDailyCollectionsSync,
    rbac,
  } = useAxyCore();

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [agreementModalAccount, setAgreementModalAccount] =
    useState<CollectionAccountRecord | null>(null);

  // Quick Action Form
  const [selectedLoanId, setSelectedLoanId] = useState('');
  const [channel, setChannel] = useState<CollectionChannel>('LLAMADA');
  const [contactResult, setContactResult] = useState<CollectionContactResult>('CONTACTO_EFECTIVO_PROMESA');
  const [notes, setNotes] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [includePromise, setIncludePromise] = useState(false);
  const [promiseAmt, setPromiseAmt] = useState('');
  const [promiseDate, setPromiseDate] = useState(getSantoDomingoTodayIso());

  // Corrective action state
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [corrReason, setCorrReason] = useState('');
  const [corrNotes, setCorrNotes] = useState('');

  // Agreement / Restructuring proposal form
  const [agrLoanId, setAgrLoanId] = useState('');
  const [agrType, setAgrType] = useState<PaymentAgreementRecord['agreementType']>('ACUERDO_PAGO');
  const [agrAmount, setAgrAmount] = useState('');
  const [agrDown, setAgrDown] = useState('0');
  const [agrInstallments, setAgrInstallments] = useState('6');
  const [agrFirstDue, setAgrFirstDue] = useState(getSantoDomingoTodayIso());
  const [agrNotes, setAgrNotes] = useState('');

  // Manual Task form
  const [taskLoanId, setTaskLoanId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskPriority, setTaskPriority] = useState<CollectionPriority>('ALTA');
  const [taskDue, setTaskDue] = useState(getSantoDomingoTodayIso());
  const [taskStatusFilter, setTaskStatusFilter] = useState<'ALL' | CollectionTaskStatus>('ALL');

  const todayIso = getSantoDomingoTodayIso();
  const collectorScopeId =
    rbac.role === 'COLLECTION_AGENT' ? userProfile?.uid ?? null : null;

  const activeAccounts = useMemo(
    () =>
      collectionAccounts.filter(
        (a) =>
          a.stage !== 'CANCELADO' &&
          (rbac.role !== 'COLLECTION_AGENT' || a.assignedCollectorId === userProfile?.uid)
      ),
    [collectionAccounts, rbac.role, userProfile]
  );

  const agreementClassification = useMemo(
    () =>
      classifyAgreementsForManagement({
        agreements: paymentAgreements,
        accounts: collectionAccounts,
        payments,
        asOfDateIso: todayIso,
        collectorId: collectorScopeId,
      }),
    [paymentAgreements, collectionAccounts, payments, todayIso, collectorScopeId]
  );

  const visibleActions = useMemo(() => {
    const base =
      mode === 'my_actions'
        ? collectionActions.filter((a) => a.collectorId === userProfile?.uid)
        : collectionActions;
    return [...base].sort((a, b) => (b.actionTimeIso || '').localeCompare(a.actionTimeIso || ''));
  }, [collectionActions, mode, userProfile]);

  const visibleTasks = useMemo(() => {
    return collectionTasks
      .filter((t) => {
        if (rbac.role === 'COLLECTION_AGENT' && t.assignedToUserId !== userProfile?.uid) return false;
        if (taskStatusFilter !== 'ALL' && t.status !== taskStatusFilter) return false;
        return true;
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [collectionTasks, rbac.role, userProfile, taskStatusFilter]);

  const selectedAccount =
    activeAccounts.find((a) => a.loanId === selectedLoanId) ?? activeAccounts[0] ?? null;

  const guardPreview = useMemo(() => {
    if (!selectedAccount) return null;
    return validateContactPermission({
      loanId: selectedAccount.loanId,
      policy: activeCollectionPolicy,
      actions: collectionActions,
      messageEvents,
      disputes: customerDisputes,
      isAutomatedBot: false,
    });
  }, [selectedAccount, activeCollectionPolicy, collectionActions, messageEvents, customerDisputes]);

  const handleSubmitAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !selectedAccount) return;
    setBusy(true);
    setFeedback(null);
    try {
      await recordCollectionAction({
        account: selectedAccount,
        user: userProfile,
        channel,
        contactResult,
        notes,
        nextActionDate: nextDate || null,
        createPromise:
          includePromise && Number(promiseAmt) > 0 && promiseDate
            ? { promisedAmount: Number(promiseAmt), promisedDate: promiseDate, notes }
            : null,
        policy: activeCollectionPolicy,
        existingActions: collectionActions,
        disputes: customerDisputes,
      });
      setNotes('');
      setIncludePromise(false);
      setPromiseAmt('');
      setFeedback({ type: 'ok', msg: 'Gestión cerrada e inmutable registrada correctamente.' });
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Error registrando gestión.' });
    } finally {
      setBusy(false);
    }
  };

  const handleProposeAgreement = async (e: React.FormEvent) => {
    e.preventDefault();
    const acc = activeAccounts.find((a) => a.loanId === (agrLoanId || activeAccounts[0]?.loanId));
    if (!userProfile || !acc) return;
    setBusy(true);
    setFeedback(null);
    try {
      await proposePaymentAgreement({
        account: acc,
        agreementType: agrType,
        totalAgreedAmount: Number(agrAmount),
        downPaymentAmount: Number(agrDown || 0),
        installmentCount: Number(agrInstallments || 1),
        firstDueDate: agrFirstDue,
        notes: agrNotes,
        activateImmediately:
          agrType === 'ACUERDO_PAGO' && rbac.hasPermission('RESOLVE_DISPUTES_AND_AGREEMENTS'),
        user: userProfile,
      });
      setAgrAmount('');
      setAgrNotes('');
      setFeedback({
        type: 'ok',
        msg: 'Acuerdo registrado para gestión en Gestiones de Cobros.',
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Error proponiendo acuerdo.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateManualTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const acc = activeAccounts.find((a) => a.loanId === (taskLoanId || activeAccounts[0]?.loanId));
    if (!userProfile || !acc) return;
    setBusy(true);
    setFeedback(null);
    try {
      await createManualCollectionTask({
        account: acc,
        assignedToUserId: acc.assignedCollectorId || userProfile.uid,
        assignedToUserName: acc.assignedCollectorName || userProfile.displayName,
        priority: taskPriority,
        title: taskTitle,
        description: taskDesc,
        dueDate: taskDue,
        user: userProfile,
      });
      setTaskTitle('');
      setTaskDesc('');
      setFeedback({ type: 'ok', msg: 'Tarea de seguimiento agregada a la Agenda.' });
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Error creando tarea.' });
    } finally {
      setBusy(false);
    }
  };

  const handleAgreementStatusChange = async (
    agr: PaymentAgreementRecord,
    nextStatus: 'ACTIVO' | 'CUMPLIDO' | 'INCUMPLIDO',
    managementNotes: string
  ) => {
    if (!userProfile) return;
    setBusy(true);
    setFeedback(null);
    try {
      await updatePaymentAgreementManagementStatus({
        agreement: agr,
        nextStatus,
        managementNotes,
        user: userProfile,
      });
      setFeedback({
        type: 'ok',
        msg: `Acuerdo ${agr.loanNumber} (${agr.customerName}) actualizado a ${nextStatus}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'No se pudo actualizar el estado del acuerdo.',
      });
    } finally {
      setBusy(false);
    }
  };

  const isGestionesGroup =
    mode === 'all_actions' || mode === 'agreements_today' || mode === 'agreements_broken';

  const canRegisterAgreement =
    rbac.hasPermission('MANAGE_PROMISES') ||
    rbac.hasPermission('LOG_COLLECTION_ACTIONS') ||
    rbac.hasPermission('RESOLVE_DISPUTES_AND_AGREEMENTS');

  const canResolveAgreement = rbac.hasPermission('RESOLVE_DISPUTES_AND_AGREEMENTS');

  const renderHeaderTitle = () => {
    switch (mode) {
      case 'my_actions':
        return 'Mis Gestiones de Cobranza';
      case 'agreements_today':
        return 'Gestiones de Cobros · Acuerdos del Día';
      case 'agreements_broken':
        return 'Gestiones de Cobros · Acuerdos Incumplidos';
      case 'all_actions':
        return 'Gestiones de Cobros';
      case 'promises':
        return 'Promesas de Pago, Acuerdos y Reestructuraciones';
      case 'agenda':
        return 'Agenda Operativa de Seguimiento';
    }
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            {mode === 'my_actions' && <UserCheck className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />}
            {mode === 'all_actions' && <ListChecks className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />}
            {mode === 'agreements_today' && <Handshake className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />}
            {mode === 'agreements_broken' && <AlertTriangle className="w-5 h-5 text-rose-500" />}
            {mode === 'promises' && <Handshake className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />}
            {mode === 'agenda' && <CalendarClock className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />}
            {renderHeaderTitle()}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-0.5">
            {mode === 'agreements_today'
              ? `Clientes cuyo acuerdo de pago se cumplió hoy (${todayIso}) y requieren gestión de cobro o confirmación.`
              : mode === 'agreements_broken'
              ? 'Clientes que no cumplieron sus acuerdos de pago pactados en la fecha comprometida.'
              : mode === 'promises'
              ? 'Una promesa solo pasa a CUMPLIDA con pago verificado y APLICADO. Comprobantes reportados mantienen la promesa en PENDIENTE_VERIFICACION.'
              : mode === 'agenda'
              ? 'Combina tareas automáticas deduplicadas por evento y tareas manuales de seguimiento.'
              : 'Registra acuerdos de pago, atiende acuerdos del día/incumplidos y conserva la bitácora inmutable de gestiones.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isGestionesGroup && canRegisterAgreement && selectedAccount && (
            <button
              type="button"
              onClick={() => setAgreementModalAccount(selectedAccount)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient hover:brightness-110 text-white font-semibold cursor-pointer"
            >
              <Handshake className="w-3.5 h-3.5" />
              Registrar Acuerdo de Pago
            </button>
          )}
          {mode === 'agenda' && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const res = await runDailyCollectionsSync({ saveSnapshot: false });
                setFeedback({
                  type: 'ok',
                  msg: `Sincronización completada: ${res.newTasks} nuevas tareas automáticas generadas sin duplicados.`,
                });
                setBusy(false);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              Generar Tareas Automáticas (Idempotente)
            </button>
          )}
        </div>
      </div>

      {/* Submenu de Gestiones de Cobros */}
      {isGestionesGroup && (
        <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 w-fit">
          {rbac.canAccessSection('cobranza_actions') && (
            <button
              type="button"
              onClick={() => setActiveSection('cobranza_actions')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold transition cursor-pointer ${
                mode === 'all_actions'
                  ? 'axy-brand-gradient text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'
              }`}
            >
              <ListChecks className="w-3.5 h-3.5" />
              <span>Bitácora de Gestiones</span>
              <span className="font-mono tabular-nums opacity-85">({visibleActions.length})</span>
            </button>
          )}
          {rbac.canAccessSection('cobranza_agreements_today') && (
            <button
              type="button"
              onClick={() => setActiveSection('cobranza_agreements_today')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold transition cursor-pointer ${
                mode === 'agreements_today'
                  ? 'axy-brand-gradient text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'
              }`}
            >
              <Handshake className="w-3.5 h-3.5" />
              <span>Acuerdos del Día</span>
              <span className="font-mono tabular-nums opacity-85">
                ({agreementClassification.acuerdosDelDia.length})
              </span>
            </button>
          )}
          {rbac.canAccessSection('cobranza_agreements_broken') && (
            <button
              type="button"
              onClick={() => setActiveSection('cobranza_agreements_broken')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold transition cursor-pointer ${
                mode === 'agreements_broken'
                  ? 'bg-rose-700 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Acuerdos Incumplidos</span>
              <span className="font-mono tabular-nums opacity-85">
                ({agreementClassification.acuerdosIncumplidos.length})
              </span>
            </button>
          )}
        </div>
      )}

      {feedback && (
        <div
          className={`p-3 rounded-xl border ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* ACUERDOS DEL DÍA SUBMENU VIEW */}
      {mode === 'agreements_today' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 overflow-x-auto">
            <div className="p-4 border-b border-slate-200/80 dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                  Acuerdos del Día a Gestionar ({agreementClassification.acuerdosDelDia.length})
                </h3>
                <p className="text-slate-500 dark:text-slate-400">
                  Clientes cuya fecha de acuerdo es hoy ({todayIso}) y deben ser contactados/gestionados.
                </p>
              </div>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-white/[0.08] bg-slate-50/90 dark:bg-white/[0.03] text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4 font-semibold">Cliente / Préstamo</th>
                  <th className="py-3 px-3 font-semibold">Fecha Acuerdo</th>
                  <th className="py-3 px-3 font-semibold text-right">Monto Acordado</th>
                  <th className="py-3 px-3 font-semibold text-right">Aplicado Verif.</th>
                  <th className="py-3 px-3 font-semibold">Estado / Condiciones</th>
                  <th className="py-3 px-4 font-semibold text-right">Gestión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-white/[0.06]">
                {agreementClassification.acuerdosDelDia.map((item) => (
                  <tr key={item.agreement.id} className="hover:bg-slate-50/80 dark:hover:bg-white/[0.025]">
                    <td className="py-3 px-4">
                      <p className="font-mono font-bold text-slate-950 dark:text-white">
                        {item.agreement.loanNumber}
                      </p>
                      <p className="font-medium text-slate-800 dark:text-slate-200">
                        {item.agreement.customerName}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {item.account ? `${item.account.dpd} DPD · Tel: ${item.account.customerPhone || '—'}` : '—'}
                      </p>
                    </td>
                    <td className="py-3 px-3 font-mono font-semibold text-[#0052CC] dark:text-[#00D1FF]">
                      {item.agreement.firstDueDate}
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-right font-semibold">
                      {formatMoney(item.agreement.totalAgreedAmount, item.agreement.currency)}
                      <span className="block text-[11px] text-slate-500">
                        {item.agreement.installmentCount} cuotas
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-right text-emerald-700 dark:text-emerald-400 font-semibold">
                      {formatMoney(item.fulfilledAmount, item.agreement.currency)}
                    </td>
                    <td className="py-3 px-3 max-w-xs">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {item.effectiveStatus}
                      </span>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {item.agreement.notes}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedLoanId(item.agreement.loanId);
                            setActiveSection('cobranza_actions');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#040C1E] border border-[#00B8FF]/30 text-[#00D1FF] font-semibold cursor-pointer"
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          Gestionar
                        </button>
                        {canResolveAgreement && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleAgreementStatusChange(
                                  item.agreement,
                                  'CUMPLIDO',
                                  'Acuerdo verificado y marcado cumplido desde Acuerdos del día.'
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Cumplido
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleAgreementStatusChange(
                                  item.agreement,
                                  'INCUMPLIDO',
                                  'Cliente no cumplió el acuerdo en la fecha pactada.'
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 font-semibold cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Incumplido
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedCollectionLoanId(item.agreement.loanId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 font-semibold cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          360°
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {agreementClassification.acuerdosDelDia.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No hay acuerdos de pago programados para gestión hoy ({todayIso}).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ACUERDOS INCUMPLIDOS SUBMENU VIEW */}
      {mode === 'agreements_broken' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-rose-500/25 overflow-x-auto">
            <div className="p-4 border-b border-slate-200/80 dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-bold text-rose-700 dark:text-rose-400">
                  Acuerdos de Pago Incumplidos ({agreementClassification.acuerdosIncumplidos.length})
                </h3>
                <p className="text-slate-500 dark:text-slate-400">
                  Clientes que no cumplieron sus acuerdos en la fecha pactada o permanecen en estado INCUMPLIDO.
                </p>
              </div>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-white/[0.08] bg-slate-50/90 dark:bg-white/[0.03] text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4 font-semibold">Cliente / Préstamo</th>
                  <th className="py-3 px-3 font-semibold">Fecha Compromiso</th>
                  <th className="py-3 px-3 font-semibold text-right">Acordado</th>
                  <th className="py-3 px-3 font-semibold text-right">Pagado Verif.</th>
                  <th className="py-3 px-3 font-semibold">Motivo de Incumplimiento</th>
                  <th className="py-3 px-4 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-white/[0.06]">
                {agreementClassification.acuerdosIncumplidos.map((item) => (
                  <tr key={item.agreement.id} className="hover:bg-slate-50/80 dark:hover:bg-white/[0.025]">
                    <td className="py-3 px-4">
                      <p className="font-mono font-bold text-slate-950 dark:text-white">
                        {item.agreement.loanNumber}
                      </p>
                      <p className="font-medium text-slate-800 dark:text-slate-200">
                        {item.agreement.customerName}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {item.account ? `${item.account.dpd} DPD · Tel: ${item.account.customerPhone || '—'}` : '—'}
                      </p>
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-rose-700 dark:text-rose-400">
                      {item.agreement.firstDueDate}
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-right font-semibold">
                      {formatMoney(item.agreement.totalAgreedAmount, item.agreement.currency)}
                    </td>
                    <td className="py-3 px-3 font-mono tabular-nums text-right">
                      {formatMoney(item.fulfilledAmount, item.agreement.currency)}
                    </td>
                    <td className="py-3 px-3 max-w-xs">
                      <span className="font-semibold text-rose-700 dark:text-rose-400">
                        INCUMPLIDO
                      </span>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {item.reason}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        {item.account && canRegisterAgreement && (
                          <button
                            type="button"
                            onClick={() => setAgreementModalAccount(item.account!)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#040C1E] border border-[#00B8FF]/30 text-[#00D1FF] font-semibold cursor-pointer"
                          >
                            <Handshake className="w-3.5 h-3.5" />
                            Reprogramar Acuerdo
                          </button>
                        )}
                        {item.agreement.status !== 'INCUMPLIDO' && canResolveAgreement && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              handleAgreementStatusChange(
                                item.agreement,
                                'INCUMPLIDO',
                                item.reason
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Confirmar Incumplido
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedCollectionLoanId(item.agreement.loanId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 font-semibold cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          360°
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {agreementClassification.acuerdosIncumplidos.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No hay acuerdos de pago incumplidos pendientes de gestión.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(mode === 'my_actions' || mode === 'all_actions') && (
        <>
          {rbac.hasPermission('LOG_COLLECTION_ACTIONS') && activeAccounts.length > 0 && (
            <form
              onSubmit={handleSubmitAction}
              className="p-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-sm font-bold">Registrar Nueva Gestión</h3>
                {guardPreview && (
                  <span className={guardPreview.allowed ? 'text-emerald-700 dark:text-emerald-400 font-mono' : 'text-rose-700 dark:text-rose-400 font-mono'}>
                    Contactos hoy: {guardPreview.dailyContactsCount}/{guardPreview.maxDailyContacts}
                    {!guardPreview.allowed && ` · ${guardPreview.reason}`}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block mb-1 text-slate-500">Préstamo</label>
                  <select
                    value={selectedAccount?.loanId || ''}
                    onChange={(e) => setSelectedLoanId(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  >
                    {activeAccounts.map((a) => (
                      <option key={a.loanId} value={a.loanId}>
                        {a.loanNumber} · {a.applicantDisplayName} ({a.dpd} DPD)
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block mb-1 text-slate-500">Canal</label>
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as CollectionChannel)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="LLAMADA">Llamada</option>
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="VISITA_CAMPO">Visita Campo</option>
                    <option value="SMS">SMS</option>
                    <option value="EMAIL">Email</option>
                    <option value="OFICINA">Oficina</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 text-slate-500">Resultado</label>
                  <select
                    value={contactResult}
                    onChange={(e) => setContactResult(e.target.value as CollectionContactResult)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  >
                    <option value="CONTACTO_EFECTIVO_PROMESA">Contacto efectivo con promesa</option>
                    <option value="CONTACTO_SIN_ACUERDO">Contacto sin acuerdo</option>
                    <option value="SOLICITA_REESTRUCTURACION">Solicita reestructuración</option>
                    <option value="NO_CONTESTA">No contesta</option>
                    <option value="BUZON">Buzón</option>
                    <option value="NUMERO_EQUIVOCADO_O_INACTIVO">Número equivocado</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 text-slate-500">Próximo seguimiento</label>
                  <input
                    type="date"
                    value={nextDate}
                    onChange={(e) => setNextDate(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                  />
                </div>
              </div>

              <textarea
                rows={2}
                required
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalle de la gestión..."
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includePromise}
                    onChange={(e) => setIncludePromise(e.target.checked)}
                  />
                  Registrar promesa de pago asociada
                </label>

                <button
                  type="submit"
                  disabled={busy || (guardPreview ? !guardPreview.allowed : false)}
                  className="px-4 py-2 rounded-lg axy-brand-gradient hover:brightness-110 text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  Guardar Gestión
                </button>
              </div>

              {includePromise && selectedAccount && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <input
                    type="number"
                    step="0.01"
                    placeholder={`Monto prometido (${selectedAccount.currency})`}
                    value={promiseAmt}
                    onChange={(e) => setPromiseAmt(e.target.value)}
                    className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                  />
                  <input
                    type="date"
                    value={promiseDate}
                    onChange={(e) => setPromiseDate(e.target.value)}
                    className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                  />
                </div>
              )}
            </form>
          )}

          <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/15 overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                  <th className="py-3 px-4">Fecha / Hora</th>
                  <th className="py-3 px-3">Préstamo / Cliente</th>
                  <th className="py-3 px-3">Canal / Resultado</th>
                  <th className="py-3 px-3">Notas</th>
                  <th className="py-3 px-3">Gestor</th>
                  <th className="py-3 px-3">Trazabilidad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {visibleActions.map((act) => (
                  <React.Fragment key={act.id}>
                    <tr>
                      <td className="py-2.5 px-4 font-mono whitespace-nowrap">
                        {formatTimestamp(act.actionTimeIso)}
                      </td>
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={() => setSelectedCollectionLoanId(act.loanId)}
                          className="font-mono font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                        >
                          {act.loanNumber}
                        </button>
                        <p>{act.customerName}</p>
                      </td>
                      <td className="py-2.5 px-3">
                        <p className="font-semibold">{act.channel}</p>
                        <p className="text-slate-500">{act.contactResult}</p>
                      </td>
                      <td className="py-2.5 px-3 max-w-md">{act.notes}</td>
                      <td className="py-2.5 px-3">{act.collectorName}</td>
                      <td className="py-2.5 px-3">
                        {act.correctsActionId ? (
                          <span className="text-sky-700 dark:text-sky-400 font-semibold">
                            Corrige {act.correctsActionId}
                          </span>
                        ) : act.supersededByActionId ? (
                          <span className="text-slate-400">Corregida</span>
                        ) : rbac.hasPermission('LOG_COLLECTION_ACTIONS') ? (
                          <button
                            type="button"
                            onClick={() => {
                              setCorrectingId(act.id);
                              setCorrNotes(act.notes);
                            }}
                            className="text-sky-700 dark:text-sky-400 font-semibold hover:underline cursor-pointer"
                          >
                            Corregir
                          </button>
                        ) : (
                          'Cerrada'
                        )}
                      </td>
                    </tr>
                    {correctingId === act.id && userProfile && (
                      <tr>
                        <td colSpan={6} className="p-3 bg-slate-50 dark:bg-slate-800/40">
                          <div className="flex flex-wrap gap-2">
                            <input
                              value={corrReason}
                              onChange={(e) => setCorrReason(e.target.value)}
                              placeholder="Motivo de corrección (obligatorio)..."
                              className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                            <input
                              value={corrNotes}
                              onChange={(e) => setCorrNotes(e.target.value)}
                              className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                await correctClosedCollectionAction({
                                  originalAction: act,
                                  user: userProfile,
                                  correctedResult: act.contactResult,
                                  correctedNotes: corrNotes,
                                  correctionReason: corrReason,
                                });
                                setCorrectingId(null);
                                setCorrReason('');
                              }}
                              className="px-3 py-1.5 rounded bg-sky-700 text-white font-semibold cursor-pointer"
                            >
                              Registrar Corrección
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {visibleActions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No hay gestiones registradas aún.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {mode === 'promises' && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-display text-sm font-bold">Promesas de Pago ({paymentPromises.length})</h3>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                  <th className="py-2.5 px-4">Préstamo / Cliente</th>
                  <th className="py-2.5 px-3">Fecha Promesa</th>
                  <th className="py-2.5 px-3">Monto Prometido</th>
                  <th className="py-2.5 px-3">Aplicado Verificado</th>
                  <th className="py-2.5 px-3">Estado</th>
                  <th className="py-2.5 px-3">Gestor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {paymentPromises.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 px-4">
                      <button
                        type="button"
                        onClick={() => setSelectedCollectionLoanId(p.loanId)}
                        className="font-mono font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                      >
                        {p.loanNumber}
                      </button>
                      <p>{p.customerName}</p>
                    </td>
                    <td className="py-2.5 px-3 font-mono">{p.promisedDate}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums font-semibold">
                      {formatMoney(p.promisedAmount, p.currency)}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatMoney(p.fulfilledAmount, p.currency)}
                    </td>
                    <td className="py-2.5 px-3 font-semibold">{p.status}</td>
                    <td className="py-2.5 px-3">{p.createdByUserName}</td>
                  </tr>
                ))}
                {paymentPromises.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      Sin promesas registradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {rbac.hasPermission('MANAGE_PROMISES') && activeAccounts.length > 0 && (
            <form
              onSubmit={handleProposeAgreement}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
            >
              <h3 className="font-display text-sm font-bold">
                Proponer Acuerdo de Pago o Reestructuración / Refinanciamiento
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <select
                  value={agrLoanId || activeAccounts[0]?.loanId}
                  onChange={(e) => setAgrLoanId(e.target.value)}
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  {activeAccounts.map((a) => (
                    <option key={a.loanId} value={a.loanId}>
                      {a.loanNumber} · {a.applicantDisplayName}
                    </option>
                  ))}
                </select>
                <select
                  value={agrType}
                  onChange={(e) => setAgrType(e.target.value as PaymentAgreementRecord['agreementType'])}
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="ACUERDO_PAGO">Acuerdo de Pago</option>
                  <option value="REESTRUCTURACION">Reestructuración</option>
                  <option value="REFINANCIAMIENTO">Refinanciamiento</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={agrAmount}
                  onChange={(e) => setAgrAmount(e.target.value)}
                  placeholder="Monto total acordado"
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
                <input
                  type="number"
                  step="0.01"
                  value={agrDown}
                  onChange={(e) => setAgrDown(e.target.value)}
                  placeholder="Inicial / Abono"
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
                <input
                  type="number"
                  min={1}
                  value={agrInstallments}
                  onChange={(e) => setAgrInstallments(e.target.value)}
                  placeholder="Número de cuotas"
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
                <input
                  type="date"
                  value={agrFirstDue}
                  onChange={(e) => setAgrFirstDue(e.target.value)}
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>
              <textarea
                rows={2}
                required
                value={agrNotes}
                onChange={(e) => setAgrNotes(e.target.value)}
                placeholder="Condiciones y justificación del acuerdo..."
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-sky-700 text-white font-semibold cursor-pointer"
              >
                Enviar Propuesta para Aprobación
              </button>
            </form>
          )}

          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-display text-sm font-bold">
                Acuerdos y Solicitudes de Reestructuración ({paymentAgreements.length})
              </h3>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                  <th className="py-2.5 px-4">Préstamo</th>
                  <th className="py-2.5 px-3">Tipo</th>
                  <th className="py-2.5 px-3">Monto / Cuotas</th>
                  <th className="py-2.5 px-3">Propuesto por</th>
                  <th className="py-2.5 px-3">Estado</th>
                  <th className="py-2.5 px-3">Decisión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {paymentAgreements.map((agr) => (
                  <tr key={agr.id}>
                    <td className="py-2.5 px-4">
                      <span className="font-mono font-bold">{agr.loanNumber}</span>
                      <p>{agr.customerName}</p>
                    </td>
                    <td className="py-2.5 px-3 font-semibold">{agr.agreementType}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums">
                      {formatMoney(agr.totalAgreedAmount, agr.currency)} ({agr.installmentCount} cuotas)
                    </td>
                    <td className="py-2.5 px-3">{agr.proposedByName}</td>
                    <td className="py-2.5 px-3 font-semibold">{agr.status}</td>
                    <td className="py-2.5 px-3">
                      {agr.status === 'PROPUESTO' && rbac.hasPermission('RESOLVE_DISPUTES_AND_AGREEMENTS') && userProfile ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await decidePaymentAgreement({
                                  agreement: agr,
                                  decision: 'APROBADO',
                                  user: userProfile,
                                });
                                setFeedback({ type: 'ok', msg: `Acuerdo ${agr.id} aprobado.` });
                              } catch (err) {
                                setFeedback({
                                  type: 'err',
                                  msg: err instanceof Error ? err.message : 'Error aprobando acuerdo.',
                                });
                              }
                            }}
                            className="px-2.5 py-1 rounded bg-emerald-700 text-white font-semibold cursor-pointer"
                          >
                            Aprobar
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              decidePaymentAgreement({
                                agreement: agr,
                                decision: 'RECHAZADO',
                                rejectedReason: 'Rechazado por revisión de política.',
                                user: userProfile,
                              })
                            }
                            className="px-2.5 py-1 rounded border border-rose-300 text-rose-700 font-semibold cursor-pointer"
                          >
                            Rechazar
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-500">{agr.approvedByName || '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === 'agenda' && (
        <div className="space-y-5">
          {rbac.hasPermission('LOG_COLLECTION_ACTIONS') && activeAccounts.length > 0 && (
            <form
              onSubmit={handleCreateManualTask}
              className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
            >
              <h3 className="font-display text-sm font-bold flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-sky-600" />
                Programar Tarea Manual en Agenda
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <select
                  value={taskLoanId || activeAccounts[0]?.loanId}
                  onChange={(e) => setTaskLoanId(e.target.value)}
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  {activeAccounts.map((a) => (
                    <option key={a.loanId} value={a.loanId}>
                      {a.loanNumber} · {a.applicantDisplayName}
                    </option>
                  ))}
                </select>
                <input
                  required
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="Título de tarea..."
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <select
                  value={taskPriority}
                  onChange={(e) => setTaskPriority(e.target.value as CollectionPriority)}
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="CRITICA">CRÍTICA</option>
                  <option value="ALTA">ALTA</option>
                  <option value="MEDIA">MEDIA</option>
                  <option value="BAJA">BAJA</option>
                </select>
                <input
                  type="date"
                  value={taskDue}
                  onChange={(e) => setTaskDue(e.target.value)}
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>
              <div className="flex gap-2">
                <input
                  value={taskDesc}
                  onChange={(e) => setTaskDesc(e.target.value)}
                  placeholder="Instrucción / detalle..."
                  className="flex-1 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-sky-700 text-white font-semibold cursor-pointer"
                >
                  Crear Tarea
                </button>
              </div>
            </form>
          )}

          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-bold">Tareas de Agenda ({visibleTasks.length})</h3>
            <select
              value={taskStatusFilter}
              onChange={(e) => setTaskStatusFilter(e.target.value as 'ALL' | CollectionTaskStatus)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              <option value="ALL">Todos los estados</option>
              <option value="PENDIENTE">PENDIENTE</option>
              <option value="EN_PROCESO">EN_PROCESO</option>
              <option value="COMPLETADA">COMPLETADA</option>
              <option value="VENCIDA">VENCIDA</option>
            </select>
          </div>

          <div className="space-y-2">
            {visibleTasks.map((t) => (
              <div
                key={t.id}
                className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-rose-700 dark:text-rose-400">
                      {t.priority}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-white">{t.title}</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{t.description}</p>
                  <p className="font-mono text-slate-500">
                    Vence: {t.dueDate} · Tipo: {t.taskType} · Asignado: {t.assignedToUserName} · Estado: {t.status}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedCollectionLoanId(t.loanId)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold cursor-pointer"
                  >
                    Ficha 360°
                  </button>
                  {t.status !== 'COMPLETADA' && userProfile && (
                    <button
                      type="button"
                      onClick={() =>
                        updateCollectionTaskStatus({
                          task: t,
                          nextStatus: 'COMPLETADA',
                          outcomeNotes: 'Completada desde Agenda Operativa.',
                          user: userProfile,
                        })
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-semibold cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Completar
                    </button>
                  )}
                </div>
              </div>
            ))}
            {visibleTasks.length === 0 && (
              <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-slate-500">
                Sin tareas en la agenda para el filtro actual.
              </div>
            )}
          </div>
        </div>
      )}

      <PaymentAgreementModal
        account={agreementModalAccount}
        onClose={() => setAgreementModalAccount(null)}
        onSaved={(msg) => setFeedback({ type: 'ok', msg })}
      />
    </div>
  );
}
