import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Headphones,
  Plus,
  Radar,
  Send,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react';
import { useAxyCore } from '../../context/AxyCoreContext';
import {
  buildAutoAssignmentPlan,
  computeContactCenterKpis,
  processSafeBotConversationTurn,
} from '../../engine/collections/botAndSentinelEngine';
import { getSantoDomingoTodayIso } from '../../engine/collections/delinquencyEngine';
import {
  reassignCollectionAccounts,
  registerBotPaymentIntent,
  resolveCustomerDispute,
  saveBotCampaign,
  saveBotTemplate,
  saveCollectorTarget,
  updateCustomerWhatsAppConsent,
  updateRiskAlertStatus,
  dispatchBotMessageWithCompliance,
} from '../../services/collectionsStore';
import type {
  CollectionCampaignRecord,
  CollectionStage,
  MessageTemplateRecord,
  UserProfile,
} from '../../types/axycore';
import { formatMoney } from '../../utils/formatters';

export function RecoveryBotAndSentinelView({
  mode,
}: {
  mode: 'contact_center' | 'bot' | 'sentinel' | 'assignment';
}) {
  const {
    userProfile,
    usersList,
    customers,
    collectionAccounts,
    collectionActions,
    collectionAssignments,
    paymentPromises,
    payments,
    paymentIntents,
    collectorTargets,
    collectionCampaigns,
    messageTemplates,
    messageEvents,
    riskAlerts,
    customerDisputes,
    activeCollectionPolicy,
    collectionsIntegrationsStatus,
    setSelectedCollectionLoanId,
    runDailyCollectionsSync,
    rbac,
  } = useAxyCore();

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Collector target editor
  const [targetUserId, setTargetUserId] = useState('');
  const [targetUserName, setTargetUserName] = useState('');
  const [targetDop, setTargetDop] = useState('350000');
  const [targetUsd, setTargetUsd] = useState('5000');
  const [targetMaxCases, setTargetMaxCases] = useState('45');

  // Bot Template & Campaign
  const [tplName, setTplName] = useState('');
  const [tplCode, setTplCode] = useState('');
  const [tplStage, setTplStage] = useState<MessageTemplateRecord['stageTarget']>('TEMPRANA');
  const [tplBody, setTplBody] = useState(
    'Hola {{cliente}}, su préstamo {{prestamo}} presenta {{dpd}} días de atraso por {{moneda}} {{cuota}}. Para confirmar o reportar un pago responda con los últimos 4 dígitos de su cédula.'
  );
  const [campName, setCampName] = useState('');
  const [campTplId, setCampTplId] = useState('');
  const [dispatchLoanId, setDispatchLoanId] = useState('');
  const [dispatchTplId, setDispatchTplId] = useState('');

  // Safe Bot Simulator
  const [simLoanId, setSimLoanId] = useState('');
  const [simInput, setSimInput] = useState('');
  const [simVerified, setSimVerified] = useState(false);
  const [simTranscript, setSimTranscript] = useState<Array<{ from: 'CLIENTE' | 'BOT'; text: string }>>([]);

  // Assignment state
  const [selectedLoanIds, setSelectedLoanIds] = useState<string[]>([]);
  const [targetCollectorId, setTargetCollectorId] = useState('');
  const [customCollectorName, setCustomCollectorName] = useState('');
  const [assignReason, setAssignReason] = useState('Balanceo operativo de cartera');

  const kpis = useMemo(
    () =>
      computeContactCenterKpis({
        accounts: collectionAccounts,
        actions: collectionActions,
        promises: paymentPromises,
        payments,
      }),
    [collectionAccounts, collectionActions, paymentPromises, payments]
  );

  const collectorsList = useMemo<UserProfile[]>(() => {
    const map = new Map<string, UserProfile>();
    usersList
      .filter((u) => u.status === 'ACTIVE' && ['COLLECTION_AGENT', 'SUPERVISOR', 'COLLECTION_COORDINATOR'].includes(u.role))
      .forEach((u) => map.set(u.uid, u));

    for (const t of collectorTargets) {
      if (!map.has(t.userId)) {
        map.set(t.userId, {
          uid: t.userId,
          email: '',
          displayName: t.userName,
          role: 'COLLECTION_AGENT',
          organizationId: t.organizationId,
          status: 'ACTIVE',
        });
      }
    }
    for (const acc of collectionAccounts) {
      if (acc.assignedCollectorId && !map.has(acc.assignedCollectorId)) {
        map.set(acc.assignedCollectorId, {
          uid: acc.assignedCollectorId,
          email: '',
          displayName: acc.assignedCollectorName || acc.assignedCollectorId,
          role: 'COLLECTION_AGENT',
          organizationId: acc.organizationId,
          status: 'ACTIVE',
        });
      }
    }
    if (userProfile && !map.has(userProfile.uid)) {
      map.set(userProfile.uid, userProfile);
    }
    return Array.from(map.values());
  }, [usersList, collectorTargets, collectionAccounts, userProfile]);

  const activeAccounts = useMemo(
    () => collectionAccounts.filter((a) => a.stage !== 'CANCELADO'),
    [collectionAccounts]
  );

  const autoAssignPlan = useMemo(
    () =>
      buildAutoAssignmentPlan({
        accounts: activeAccounts,
        collectors: collectorsList,
        targets: collectorTargets,
        onlyUnassigned: false,
      }),
    [activeAccounts, collectorsList, collectorTargets]
  );

  const simAccount = activeAccounts.find((a) => a.loanId === (simLoanId || activeAccounts[0]?.loanId)) ?? null;
  const simCustomer = simAccount
    ? customers.find((c) => c.id === simAccount.customerId) ?? null
    : null;

  const handleSaveTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    const uid = (targetUserId || userProfile.uid).trim();
    const uName =
      targetUserName.trim() ||
      collectorsList.find((c) => c.uid === uid)?.displayName ||
      userProfile.displayName;
    const ym = getSantoDomingoTodayIso().slice(0, 7);
    setBusy(true);
    try {
      await saveCollectorTarget({
        target: {
          id: `tgt_${uid}_${ym}`,
          organizationId: userProfile.organizationId,
          userId: uid,
          userName: uName,
          periodYm: ym,
          targetAmountDop: Number(targetDop || 0),
          targetAmountUsd: Number(targetUsd || 0),
          maxCasesLimit: Number(targetMaxCases || 40),
          promiseFulfillmentTargetPct: 75,
          active: true,
        },
        user: userProfile,
      });
      setFeedback({ type: 'ok', msg: `Meta mensual guardada para ${uName} (${ym}).` });
    } finally {
      setBusy(false);
    }
  };

  const handleSimTurn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simAccount || !simInput.trim() || !userProfile) return;
    const last4 = (simCustomer?.documentNumber || '0000').replace(/\D/g, '').slice(-4);
    const res = processSafeBotConversationTurn({
      inboundText: simInput,
      account: simAccount,
      customerDocumentLast4: last4,
      identityAlreadyVerified: simVerified,
    });
    setSimVerified(res.verifiedIdentity);
    setSimTranscript((prev) => [
      ...prev,
      { from: 'CLIENTE', text: simInput },
      { from: 'BOT', text: res.replyText },
    ]);
    if (res.shouldOptOut) {
      await updateCustomerWhatsAppConsent({
        account: simAccount,
        optIn: false,
        user: userProfile,
      });
    }
    if (res.shouldCreatePaymentIntent) {
      await registerBotPaymentIntent({
        account: simAccount,
        reportedAmount: simAccount.nextDueAmount || simAccount.overdueTotalAmount || 1000,
        referenceNumber: `BOT-${Date.now().toString().slice(-6)}`,
        notes: simInput,
        user: userProfile,
      });
    }
    setSimInput('');
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            {mode === 'contact_center' && <Headphones className="w-5 h-5 text-sky-600" />}
            {mode === 'bot' && <Bot className="w-5 h-5 text-sky-600" />}
            {mode === 'sentinel' && <Radar className="w-5 h-5 text-amber-600" />}
            {mode === 'assignment' && <Users className="w-5 h-5 text-sky-600" />}
            {mode === 'contact_center'
              ? 'Contact Center y Desempeño de Gestores'
              : mode === 'bot'
              ? 'AxyRecovery Bot (WhatsApp & Mensajería Regulada)'
              : mode === 'sentinel'
              ? 'Centinela de Riesgos, Alertas y Reclamaciones'
              : 'Asignación y Balanceo de Cartera'}
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            {mode === 'contact_center'
              ? 'Productividad real por gestor diferenciando estrictamente dinero APLICADO vs montos reportados pendientes de verificación.'
              : mode === 'bot'
              ? 'Control de consentimiento Opt-In/Opt-Out, horarios, tope semanal, verificación de identidad por últimos 4 dígitos y estado real de conexión WhatsApp Cloud API.'
              : mode === 'sentinel'
              ? 'Motor de 13 reglas de riesgo operativo, score de comportamiento separado de originación V2 y gestión de reclamaciones.'
              : 'Reasignación individual, masiva o automática equitativa preservando intacto todo el historial de gestiones previas.'}
          </p>
        </div>

        {mode === 'bot' && (
          <div
            className={`px-3 py-2 rounded-xl border font-semibold ${
              collectionsIntegrationsStatus.whatsappCloudApiConfigured
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
                : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
            }`}
          >
            WhatsApp Cloud API: {collectionsIntegrationsStatus.whatsappMode}
          </div>
        )}

        {mode === 'sentinel' && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await runDailyCollectionsSync({ saveSnapshot: false });
              setFeedback({
                type: 'ok',
                msg: `Escaneo Centinela completado: ${res.newAlerts} alertas nuevas detectadas.`,
              });
              setBusy(false);
            }}
            className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-semibold cursor-pointer"
          >
            Ejecutar Escaneo Centinela (13 Reglas)
          </button>
        )}
      </div>

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

      {mode === 'contact_center' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <p className="text-slate-500">Contactabilidad</p>
              <p className="font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-white">
                {kpis.contactabilityPct}%
              </p>
              <p className="text-slate-500">
                {kpis.effectiveContacts} / {kpis.totalActions} gestiones
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <p className="text-slate-500">Promesas Cumplidas</p>
              <p className="font-mono tabular-nums text-xl font-bold text-emerald-700 dark:text-emerald-400">
                {kpis.promiseFulfillmentPct}%
              </p>
              <p className="text-slate-500">
                {kpis.promisesFulfilledCount} / {kpis.promisesEvaluatedCount} evaluadas
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <p className="text-slate-500">Recuperado APLICADO DOP</p>
              <p className="font-mono tabular-nums text-lg font-bold text-sky-700 dark:text-sky-400">
                {formatMoney(kpis.recoveredAppliedDop, 'DOP')}
              </p>
              <p className="text-amber-700 dark:text-amber-400 font-mono">
                Pend: {formatMoney(kpis.pendingVerificationDop, 'DOP')}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <p className="text-slate-500">Recuperado APLICADO USD</p>
              <p className="font-mono tabular-nums text-lg font-bold text-sky-700 dark:text-sky-400">
                {formatMoney(kpis.recoveredAppliedUsd, 'USD')}
              </p>
              <p className="text-amber-700 dark:text-amber-400 font-mono">
                Pend: {formatMoney(kpis.pendingVerificationUsd, 'USD')}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <p className="text-slate-500">Vencidas Sin Gestión</p>
              <p className="font-mono tabular-nums text-xl font-bold text-rose-700 dark:text-rose-400">
                {kpis.overdueAccountsWithoutAction}
              </p>
              <p className="text-slate-500">Requieren primer contacto</p>
            </div>
          </div>

          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                  <th className="py-3 px-4">Gestor / Oficial</th>
                  <th className="py-3 px-3">Cuentas Asignadas</th>
                  <th className="py-3 px-3">Gestiones</th>
                  <th className="py-3 px-3">Contactos Efectivos</th>
                  <th className="py-3 px-3">Promesas (Cumpl./Tot.)</th>
                  <th className="py-3 px-3">Recuperado DOP</th>
                  <th className="py-3 px-3">Recuperado USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                {kpis.collectorBreakdown.map((row) => (
                  <tr key={row.collectorId}>
                    <td className="py-2.5 px-4 font-sans font-semibold">{row.collectorName}</td>
                    <td className="py-2.5 px-3">{row.assignedAccounts}</td>
                    <td className="py-2.5 px-3">{row.actionsCount}</td>
                    <td className="py-2.5 px-3">{row.effectiveContactsCount}</td>
                    <td className="py-2.5 px-3">
                      {row.promisesFulfilledCount} / {row.promisesCount}
                    </td>
                    <td className="py-2.5 px-3 text-emerald-700 dark:text-emerald-400">
                      {formatMoney(row.recoveredAppliedDop, 'DOP')}
                    </td>
                    <td className="py-2.5 px-3 text-emerald-700 dark:text-emerald-400">
                      {formatMoney(row.recoveredAppliedUsd, 'USD')}
                    </td>
                  </tr>
                ))}
                {kpis.collectorBreakdown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-500 font-sans">
                      Sin actividad registrada de gestores todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {rbac.hasPermission('ASSIGN_COLLECTIONS_PORTFOLIO') && (
            <form
              onSubmit={handleSaveTarget}
              className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
            >
              <h3 className="font-display text-sm font-bold">Configurar Metas Mensuales por Gestor</h3>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                <input
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  placeholder="UID Gestor (o vacío = mi UID)"
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
                <input
                  value={targetUserName}
                  onChange={(e) => setTargetUserName(e.target.value)}
                  placeholder="Nombre del gestor"
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <input
                  type="number"
                  value={targetDop}
                  onChange={(e) => setTargetDop(e.target.value)}
                  placeholder="Meta DOP"
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
                <input
                  type="number"
                  value={targetUsd}
                  onChange={(e) => setTargetUsd(e.target.value)}
                  placeholder="Meta USD"
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-sky-700 text-white font-semibold cursor-pointer"
                >
                  Guardar Meta
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {mode === 'bot' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Dispatch & Templates */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <h3 className="font-display text-sm font-bold flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-sky-600" />
                Plantillas Aprobadas ({messageTemplates.length}) y Campañas ({collectionCampaigns.length})
              </h3>
              {rbac.hasPermission('MANAGE_COLLECTION_BOT') && userProfile && (
                <div className="space-y-2 border-b border-slate-200 dark:border-slate-800 pb-4">
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      value={tplCode}
                      onChange={(e) => setTplCode(e.target.value)}
                      placeholder="Código (ej. MORA_TEMPRANA_V1)"
                      className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                    <input
                      value={tplName}
                      onChange={(e) => setTplName(e.target.value)}
                      placeholder="Nombre de plantilla"
                      className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                    <select
                      value={tplStage}
                      onChange={(e) =>
                        setTplStage(e.target.value as MessageTemplateRecord['stageTarget'])
                      }
                      className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    >
                      <option value="VENCIMIENTO_PROXIMO">Vencimiento Próximo</option>
                      <option value="PREVENTIVA">Preventiva</option>
                      <option value="TEMPRANA">Temprana</option>
                      <option value="INTERMEDIA">Intermedia</option>
                      <option value="GENERAL">General</option>
                    </select>
                  </div>
                  <textarea
                    rows={2}
                    value={tplBody}
                    onChange={(e) => setTplBody(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const code = tplCode.trim() || `TPL_${Date.now().toString().slice(-4)}`;
                      await saveBotTemplate({
                        template: {
                          id: `tpl_${code.toLowerCase()}`,
                          organizationId: userProfile.organizationId,
                          code,
                          name: tplName.trim() || code,
                          channel: 'WHATSAPP',
                          stageTarget: tplStage,
                          bodyTemplate: tplBody,
                          approvalStatus: 'APROBADA',
                          variables: ['cliente', 'prestamo', 'moneda', 'cuota', 'dpd'],
                        },
                        user: userProfile,
                      });
                      setTplCode('');
                      setTplName('');
                      setFeedback({ type: 'ok', msg: `Plantilla ${code} guardada como APROBADA.` });
                    }}
                    className="px-3 py-1.5 rounded-lg bg-sky-700 text-white font-semibold cursor-pointer"
                  >
                    Guardar Plantilla Aprobada
                  </button>
                </div>
              )}

              {/* Dispatch single compliant message */}
              {activeAccounts.length > 0 && messageTemplates.length > 0 && userProfile && (
                <div className="space-y-2">
                  <p className="font-semibold">Enviar Recordatorio Regulado (Valida Opt-In, Reclamación, Horario y Límite Semanal)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={dispatchLoanId || activeAccounts[0].loanId}
                      onChange={(e) => setDispatchLoanId(e.target.value)}
                      className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    >
                      {activeAccounts.map((a) => (
                        <option key={a.loanId} value={a.loanId}>
                          {a.loanNumber} · {a.applicantDisplayName} ({a.consentWhatsAppOptIn ? 'Opt-In' : 'OPT-OUT'})
                        </option>
                      ))}
                    </select>
                    <select
                      value={dispatchTplId || messageTemplates[0].id}
                      onChange={(e) => setDispatchTplId(e.target.value)}
                      className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    >
                      {messageTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.code} ({t.approvalStatus})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const acc = activeAccounts.find(
                        (a) => a.loanId === (dispatchLoanId || activeAccounts[0].loanId)
                      );
                      const tpl = messageTemplates.find(
                        (t) => t.id === (dispatchTplId || messageTemplates[0].id)
                      );
                      if (!acc || !tpl) return;
                      setBusy(true);
                      const evt = await dispatchBotMessageWithCompliance({
                        account: acc,
                        template: tpl,
                        messageEvents,
                        disputes: customerDisputes,
                        policy: activeCollectionPolicy,
                        user: userProfile,
                        whatsappApiConfigured: collectionsIntegrationsStatus.whatsappCloudApiConfigured,
                      });
                      setFeedback({
                        type: evt.deliveryStatus === 'ENVIADO' ? 'ok' : 'err',
                        msg: `Resultado Bot: ${evt.deliveryStatus}${evt.blockReason ? ` · ${evt.blockReason}` : ''}`,
                      });
                      setBusy(false);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 text-white font-semibold cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Ejecutar Envío Regulado
                  </button>
                </div>
              )}

              {rbac.hasPermission('MANAGE_COLLECTION_BOT') && messageTemplates.length > 0 && userProfile && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex gap-2">
                  <input
                    value={campName}
                    onChange={(e) => setCampName(e.target.value)}
                    placeholder="Nombre de campaña preventiva..."
                    className="flex-1 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const id = `camp_${Date.now().toString().slice(-5)}`;
                      const camp: Omit<CollectionCampaignRecord, 'createdAt' | 'updatedAt' | 'createdBy'> = {
                        id,
                        organizationId: userProfile.organizationId,
                        name: campName.trim() || 'Campaña Preventiva WhatsApp',
                        stageTarget: 'TEMPRANA',
                        templateId: campTplId || messageTemplates[0].id,
                        channel: 'WHATSAPP',
                        status: 'ACTIVA',
                        maxPerDay: 100,
                      };
                      await saveBotCampaign({ campaign: camp, user: userProfile });
                      setCampName('');
                    }}
                    className="px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 font-semibold cursor-pointer"
                  >
                    Crear Campaña
                  </button>
                </div>
              )}
            </div>

            {/* Safe Identity-Verified Bot Simulator */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-sky-600" />
                  Simulador Seguro de Conversación (Verificación Ley 172-13)
                </h3>
                <span className="font-mono text-slate-500">
                  Identidad: {simVerified ? 'VERIFICADA' : 'PENDIENTE'}
                </span>
              </div>

              {simAccount && (
                <select
                  value={simAccount.loanId}
                  onChange={(e) => {
                    setSimLoanId(e.target.value);
                    setSimVerified(false);
                    setSimTranscript([]);
                  }}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  {activeAccounts.map((a) => (
                    <option key={a.loanId} value={a.loanId}>
                      {a.loanNumber} · {a.applicantDisplayName}
                    </option>
                  ))}
                </select>
              )}

              <div className="h-44 overflow-y-auto p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 space-y-2">
                {simTranscript.length === 0 ? (
                  <p className="text-slate-500">
                    Prueba escribir «saldo», «4 dígitos de cédula», «ya pagué ref 123» o «STOP» para verificar el comportamiento regulado del Bot.
                  </p>
                ) : (
                  simTranscript.map((m, i) => (
                    <div key={i} className={m.from === 'CLIENTE' ? 'text-right' : 'text-left'}>
                      <span className="font-mono text-[10px] text-slate-400 block">{m.from}</span>
                      <span className="inline-block px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        {m.text}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleSimTurn} className="flex gap-2">
                <input
                  value={simInput}
                  onChange={(e) => setSimInput(e.target.value)}
                  placeholder="Mensaje entrante simulado del cliente..."
                  className="flex-1 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-sky-700 text-white font-semibold cursor-pointer"
                >
                  Enviar
                </button>
              </form>

              {paymentIntents.length > 0 && (
                <p className="text-slate-500">
                  Intenciones de pago reportadas por Bot: <strong className="font-mono">{paymentIntents.length}</strong> (ninguna rebaja saldo hasta conciliación).
                </p>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-display text-sm font-bold">Bitácora de Mensajes y Bloqueos ({messageEvents.length})</h3>
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                  <th className="py-2.5 px-4">Préstamo</th>
                  <th className="py-2.5 px-3">Destinatario</th>
                  <th className="py-2.5 px-3">Estado Entrega</th>
                  <th className="py-2.5 px-3">Motivo / Vista Previa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {messageEvents.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2.5 px-4 font-mono font-bold">{m.loanNumber}</td>
                    <td className="py-2.5 px-3 font-mono">{m.recipientMasked}</td>
                    <td className="py-2.5 px-3 font-semibold">{m.deliveryStatus}</td>
                    <td className="py-2.5 px-3">{m.blockReason || m.messagePreview}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === 'sentinel' && (
        <div className="space-y-6">
          <div className="space-y-2">
            <h3 className="font-display text-sm font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Alertas Tempranas Centinela ({riskAlerts.length})
            </h3>
            {riskAlerts.map((a) => (
              <div
                key={a.id}
                className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-rose-700 dark:text-rose-400">
                      {a.severity}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-white">{a.title}</span>
                    <span className="font-mono text-slate-500">· {a.loanNumber}</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{a.description}</p>
                  <p className="font-mono text-slate-500">
                    Regla: {a.ruleCode} · Indicador: {a.metricValue} · Estado: {a.status}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedCollectionLoanId(a.loanId)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold cursor-pointer"
                  >
                    Ficha 360°
                  </button>
                  {a.status === 'ACTIVA' && userProfile && (
                    <button
                      type="button"
                      onClick={() =>
                        updateRiskAlertStatus({
                          alert: a,
                          status: 'ATENDIDA',
                          notes: 'Revisada y atendida en Centinela.',
                          user: userProfile,
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-semibold cursor-pointer"
                    >
                      Marcar Atendida
                    </button>
                  )}
                </div>
              </div>
            ))}
            {riskAlerts.length === 0 && (
              <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center text-slate-500">
                Sin alertas Centinela activas. Usa «Ejecutar Escaneo Centinela» para auditar las 13 reglas.
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="font-display text-sm font-bold flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              Reclamaciones y Casos Especiales ({customerDisputes.length})
            </h3>
            {customerDisputes.map((d) => (
              <div
                key={d.id}
                className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3"
              >
                <div>
                  <p className="font-semibold">
                    {d.loanNumber} · {d.customerName} · {d.disputeType} ({d.status})
                  </p>
                  <p className="text-slate-600 dark:text-slate-300">{d.description}</p>
                  <p className="text-slate-500">
                    Bot pausado: {d.pauseAutomatedMessages ? 'SÍ' : 'NO'} · Abierta por: {d.openedByName}
                  </p>
                </div>
                {['ABIERTA', 'EN_INVESTIGACION'].includes(d.status) &&
                  rbac.hasPermission('RESOLVE_DISPUTES_AND_AGREEMENTS') &&
                  userProfile && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          resolveCustomerDispute({
                            dispute: d,
                            resolutionStatus: 'RESUELTA_FAVOR_CLIENTE',
                            resolutionNotes: 'Reclamación validada y resuelta a favor del cliente.',
                            user: userProfile,
                          })
                        }
                        className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-semibold cursor-pointer"
                      >
                        Resolver a Favor
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          resolveCustomerDispute({
                            dispute: d,
                            resolutionStatus: 'RESUELTA_IMPROCEDENTE',
                            resolutionNotes: 'Validado y documentado como improcedente.',
                            user: userProfile,
                          })
                        }
                        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold cursor-pointer"
                      >
                        Cerrar Improcedente
                      </button>
                    </div>
                  )}
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'assignment' && (
        <div className="space-y-5">
          {rbac.hasPermission('ASSIGN_COLLECTIONS_PORTFOLIO') && userProfile && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-sm font-bold">
                  Asignación Masiva / Balanceo Automático (Preserva Historial Previo)
                </h3>
                <button
                  type="button"
                  disabled={busy || autoAssignPlan.length === 0}
                  onClick={async () => {
                    setBusy(true);
                    const assignments = autoAssignPlan
                      .map((plan) => {
                        const account = activeAccounts.find((a) => a.loanId === plan.loanId);
                        return account
                          ? {
                              account,
                              newCollectorId: plan.newCollectorId,
                              newCollectorName: plan.newCollectorName,
                              reason: plan.reason,
                              ruleApplied: 'AUTO_BALANCEO',
                            }
                          : null;
                      })
                      .filter((x): x is NonNullable<typeof x> => Boolean(x));
                    await reassignCollectionAccounts({ assignments, user: userProfile });
                    setFeedback({
                      type: 'ok',
                      msg: `Auto-balanceo aplicado sobre ${assignments.length} cuentas sin eliminar historial previo.`,
                    });
                    setBusy(false);
                  }}
                  className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  Ejecutar Auto-Balanceo Equitativo ({autoAssignPlan.length})
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <select
                  value={targetCollectorId}
                  onChange={(e) => setTargetCollectorId(e.target.value)}
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="">Seleccionar gestor de directorio...</option>
                  {collectorsList.map((c) => (
                    <option key={c.uid} value={c.uid}>
                      {c.displayName} ({c.role})
                    </option>
                  ))}
                </select>
                <input
                  value={customCollectorName}
                  onChange={(e) => setCustomCollectorName(e.target.value)}
                  placeholder="O nombre personalizado"
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <input
                  value={assignReason}
                  onChange={(e) => setAssignReason(e.target.value)}
                  placeholder="Motivo de asignación"
                  className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <button
                  type="button"
                  disabled={busy || selectedLoanIds.length === 0 || (!targetCollectorId && !customCollectorName)}
                  onClick={async () => {
                    const colId = targetCollectorId || userProfile.uid;
                    const colName =
                      customCollectorName.trim() ||
                      collectorsList.find((c) => c.uid === colId)?.displayName ||
                      userProfile.displayName;
                    setBusy(true);
                    const assignments = selectedLoanIds
                      .map((lid) => {
                        const account = activeAccounts.find((a) => a.loanId === lid);
                        return account
                          ? {
                              account,
                              newCollectorId: colId,
                              newCollectorName: colName,
                              reason: assignReason,
                              ruleApplied: 'MASIVA_MANUAL',
                            }
                          : null;
                      })
                      .filter((x): x is NonNullable<typeof x> => Boolean(x));
                    await reassignCollectionAccounts({ assignments, user: userProfile });
                    setSelectedLoanIds([]);
                    setFeedback({
                      type: 'ok',
                      msg: `${assignments.length} cuentas asignadas a ${colName}.`,
                    });
                    setBusy(false);
                  }}
                  className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  Asignar Seleccionadas ({selectedLoanIds.length})
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                  <th className="py-2.5 px-4">Sel.</th>
                  <th className="py-2.5 px-3">Préstamo / Cliente</th>
                  <th className="py-2.5 px-3">Tramo / DPD</th>
                  <th className="py-2.5 px-3">Saldo Capital</th>
                  <th className="py-2.5 px-3">Gestor Actual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {activeAccounts.map((acc) => {
                  const checked = selectedLoanIds.includes(acc.loanId);
                  return (
                    <tr key={acc.loanId}>
                      <td className="py-2.5 px-4">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedLoanIds((prev) =>
                              e.target.checked
                                ? [...prev, acc.loanId]
                                : prev.filter((id) => id !== acc.loanId)
                            )
                          }
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono font-bold">{acc.loanNumber}</span> · {acc.applicantDisplayName}
                      </td>
                      <td className="py-2.5 px-3 font-mono">{acc.stage} ({acc.dpd} DPD)</td>
                      <td className="py-2.5 px-3 font-mono">
                        {formatMoney(acc.totalOutstandingPrincipal, acc.currency)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold">{acc.assignedCollectorName || 'Sin asignar'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {collectionAssignments.length > 0 && (
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
              <h3 className="font-display text-sm font-bold">
                Historial de Reasignaciones ({collectionAssignments.length})
              </h3>
              {collectionAssignments.slice(0, 10).map((asg) => (
                <p key={asg.id} className="text-slate-600 dark:text-slate-300">
                  <strong className="font-mono">{asg.loanNumber}</strong>: {asg.previousCollectorName || 'Sin asignar'} →{' '}
                  <strong>{asg.newCollectorName}</strong> ({asg.reason}) · Por {asg.assignedByName}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
