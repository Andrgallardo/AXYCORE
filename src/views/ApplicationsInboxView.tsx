import React, { useMemo, useState } from 'react';
import { ArrowRight, Bell, CheckCheck, Cpu, Eye, Mail, Pencil, Radio, RefreshCw, Search, ShieldAlert, UserCheck, X } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { ApplicationDetailDrawer } from '../components/ApplicationDetailDrawer';
import { ApplicationEditModal } from '../components/ApplicationEditModal';
import { PreEvaluationValidationAlert } from '../components/PreEvaluationValidationAlert';
import { EMAIL_EVENT_LABELS } from '../engine/emailTemplates';
import {
  PreEvaluationValidationError,
  type PreEvaluationValidationResult,
} from '../engine/preEvaluationValidation';
import {
  advanceApplicationToEvaluation,
  canEditApplicationRecord,
  reevaluateApplicationWithEngine,
  retryCustomerEmailNotification,
  validateApplicationPreEvaluationInFirestore,
} from '../services/axycoreStore';
import type { ApplicationRecord, EmailNotificationRecord } from '../types/axycore';
import {
  APPLICATION_STATUS_LABELS,
  PRODUCT_LABELS,
  SCORING_STATUS_LABELS,
  formatMoney,
  formatRatePct,
  formatTimestamp,
  formatUserFacingError,
} from '../utils/formatters';

export function ApplicationsInboxView() {
  const {
    applications,
    customers,
    activeOrTestPolicy,
    userProfile,
    selectedApplicationId,
    setSelectedApplicationId,
    setActiveSection,
    inboxAlerts,
    unreadAlertCount,
    acknowledgeAllAlerts,
    desktopNotifPermission,
    requestDesktopNotifications,
    fcmStatus,
    fcmError,
    fcmActiveDevicesCount,
    enableFcmPush,
    disableFcmPush,
    emailNotifications,
    smtpConfigured,
    rbac,
  } = useAxyCore();

  const [activeTab, setActiveTab] = useState<'applications' | 'emails'>('applications');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [prequalFilter, setPrequalFilter] = useState('ALL');
  const [onlyUrgent, setOnlyUrgent] = useState(false);
  const [emailEventFilter, setEmailEventFilter] = useState('ALL');
  const [previewEmail, setPreviewEmail] = useState<EmailNotificationRecord | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [emailFeedback, setEmailFeedback] = useState<string | null>(null);
  const [routingAppId, setRoutingAppId] = useState<string | null>(null);
  const [routingStage, setRoutingStage] = useState<'VALIDATING' | 'TRANSITIONING' | null>(null);
  const [routeFeedback, setRouteFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [validationAlert, setValidationAlert] = useState<PreEvaluationValidationResult | null>(null);
  const [revalidatingAlert, setRevalidatingAlert] = useState(false);
  const [alternateModalApp, setAlternateModalApp] = useState<ApplicationRecord | null>(null);
  const [alternateAmountInput, setAlternateAmountInput] = useState<string>('');
  const [alternateNoteInput, setAlternateNoteInput] = useState<string>('');
  const [alternateModalError, setAlternateModalError] = useState<string | null>(null);
  const [editingApp, setEditingApp] = useState<ApplicationRecord | null>(null);
  const [reevaluatingAppId, setReevaluatingAppId] = useState<string | null>(null);

  const handleRevalidateAlert = async () => {
    if (!validationAlert || !userProfile) return;
    const targetApp = applications.find((a) => a.id === validationAlert.applicationId);
    if (!targetApp) {
      setValidationAlert(null);
      return;
    }
    setRevalidatingAlert(true);
    try {
      const refreshed = await validateApplicationPreEvaluationInFirestore({
        application: targetApp,
        user: userProfile,
      });
      if (refreshed.canProceed) {
        setValidationAlert(null);
        setRouteFeedback({
          type: 'ok',
          msg: `Validación en Firestore superada para ${targetApp.applicationNumber}. Todos los datos obligatorios del cliente y documentos requeridos existen; ya puede enviarla a Evaluación.`,
        });
      } else {
        setValidationAlert(refreshed);
      }
    } catch (err) {
      setRouteFeedback({
        type: 'err',
        msg: formatUserFacingError(err, 'No se pudo re-verificar la solicitud en Firestore.'),
      });
    } finally {
      setRevalidatingAlert(false);
    }
  };

  const urgentAppIds = useMemo(() => new Set(inboxAlerts.map((a) => a.application.id)), [inboxAlerts]);

  const sortedEmails = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...emailNotifications]
      .filter((em) => {
        if (emailEventFilter !== 'ALL' && em.eventCode !== emailEventFilter) return false;
        if (!q) return true;
        return (
          em.applicationNumber.toLowerCase().includes(q) ||
          em.recipientName.toLowerCase().includes(q) ||
          em.recipientEmail.toLowerCase().includes(q) ||
          em.subject.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  }, [emailNotifications, emailEventFilter, search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return applications
      .filter((a) => {
        if (onlyUrgent && !urgentAppIds.has(a.id)) return false;
        if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
        if (prequalFilter !== 'ALL' && a.prequalificationStatus !== prequalFilter) return false;
        if (!q) return true;
        return (
          a.applicationNumber.toLowerCase().includes(q) ||
          a.applicantDisplayName.toLowerCase().includes(q) ||
          a.fileNumber.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.applicationNumber.localeCompare(a.applicationNumber));
  }, [applications, search, statusFilter, prequalFilter, onlyUrgent, urgentAppIds]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            Solicitudes Recibidas y Precalificación Automática
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Resultado inmediato del Motor de Decisiones Crediticias V2. Distingue preliminarmente PRECALIFICADO vs APROBADO contractual.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar solicitud o cliente..."
              className="axy-input pl-8 pr-3 py-1.5 text-slate-900 dark:text-white"
            />
          </div>
          <select
            value={prequalFilter}
            onChange={(e) => setPrequalFilter(e.target.value)}
            className="axy-input px-2.5 py-1.5 text-slate-900 dark:text-white"
          >
            <option value="ALL">Toda precalificación</option>
            {Object.entries(SCORING_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="axy-input px-2.5 py-1.5 text-slate-900 dark:text-white"
          >
            <option value="ALL">Todos los estados</option>
            {Object.entries(APPLICATION_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Sub-navigation: Solicitudes vs Notificaciones Email */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-[#00B8FF]/14 pb-2.5 text-xs">
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/16">
          <button
            type="button"
            onClick={() => setActiveTab('applications')}
            className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'applications'
                ? 'bg-[#0066FF] text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Solicitudes ({filtered.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('emails')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'emails'
                ? 'bg-[#0066FF] text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            Notificaciones Email al Cliente ({emailNotifications.length})
          </button>
        </div>

        {activeTab === 'emails' && (
          <span className="text-slate-500 dark:text-slate-400">
            Envío automático por correo:{' '}
            <strong className="text-slate-800 dark:text-slate-200">
              {smtpConfigured ? 'Activo' : 'En cola institucional'}
            </strong>
          </span>
        )}
      </div>

      {activeTab === 'applications' && (
        <>

      {rbac.isInternalStaff && (
        <div
          className={`px-4 py-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs ${
            inboxAlerts.length > 0
              ? 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-700/35'
              : 'bg-white dark:bg-[#08132B] border-slate-200/85 dark:border-[#00B8FF]/18'
          }`}
        >
          <div className="space-y-0.5 min-w-0">
            <p className="font-semibold text-slate-900 dark:text-white">
              {inboxAlerts.length > 0
                ? `${inboxAlerts.length} solicitudes requieren atención prioritaria (${unreadAlertCount} sin leer)`
                : 'Alertas operativas en tiempo real activas'}
            </p>
            <p className="text-slate-500 dark:text-slate-400">
              {fcmStatus === 'active'
                ? `Notificaciones en segundo plano activas en ${fcmActiveDevicesCount} dispositivo(s).`
                : fcmStatus === 'error'
                ? fcmError || 'No se pudo activar el envío de notificaciones en este dispositivo.'
                : 'Los expedientes recibidos, devueltos o pendientes de Comité aparecen automáticamente en bandeja.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {inboxAlerts.length > 0 && (
              <button
                type="button"
                onClick={() => setOnlyUrgent((v) => !v)}
                className={`px-3 py-1.5 rounded-lg border font-medium whitespace-nowrap cursor-pointer ${
                  onlyUrgent
                    ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                    : 'border-slate-200 dark:border-white/12 bg-white dark:bg-[#040C1E] hover:bg-slate-50 dark:hover:bg-white/6'
                }`}
              >
                {onlyUrgent ? 'Mostrar todas' : `Ver urgentes (${inboxAlerts.length})`}
              </button>
            )}
            {unreadAlertCount > 0 && (
              <button
                type="button"
                onClick={acknowledgeAllAlerts}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/12 bg-white dark:bg-[#040C1E] hover:bg-slate-50 dark:hover:bg-white/6 font-medium whitespace-nowrap cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Marcar todo leído
              </button>
            )}
            {desktopNotifPermission === 'default' && (
              <button
                type="button"
                onClick={requestDesktopNotifications}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0052CC] hover:bg-[#0044AD] text-white font-medium whitespace-nowrap cursor-pointer"
              >
                <Bell className="w-3.5 h-3.5" />
                Activar avisos de escritorio
              </button>
            )}
            {fcmStatus === 'active' ? (
              <button
                type="button"
                onClick={disableFcmPush}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 font-medium whitespace-nowrap cursor-pointer"
              >
                <Radio className="w-3.5 h-3.5" />
                Notificaciones activas
              </button>
            ) : (
              fcmStatus !== 'unsupported' &&
              fcmStatus !== 'vapid_missing' && (
                <button
                  type="button"
                  disabled={fcmStatus === 'registering'}
                  onClick={enableFcmPush}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg axy-brand-gradient text-white font-medium whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  <Radio className="w-3.5 h-3.5" />
                  {fcmStatus === 'registering' ? 'Activando…' : 'Activar notificaciones push'}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {validationAlert && (
        <PreEvaluationValidationAlert
          result={validationAlert}
          revalidating={revalidatingAlert}
          onClose={() => setValidationAlert(null)}
          onRevalidate={handleRevalidateAlert}
          onGoToCustomers={() =>
            setActiveSection(rbac.canAccessSection('customers_update') ? 'customers_update' : 'customers')
          }
          onGoToDocuments={(appId) => {
            setSelectedApplicationId(appId);
            setActiveSection('documents');
          }}
        />
      )}

      {routeFeedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${
            routeFeedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          <span>{routeFeedback.msg}</span>
          {routeFeedback.type === 'ok' && rbac.canAccessSection('evaluation') && (
            <button
              type="button"
              onClick={() => setActiveSection('evaluation')}
              className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
            >
              Ir a Evaluación
            </button>
          )}
        </div>
      )}

      <div className="axy-surface rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="axy-table-head text-slate-600 dark:text-slate-300">
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">N.º Solicitud</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Cliente</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Tipo Préstamo</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Moneda</th>
                <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Solicitado</th>
                <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Score</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Nivel Riesgo</th>
                <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Rec. Monto</th>
                <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Tasa Mens.</th>
                <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Plazo Rec.</th>
                <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Cuota Rec.</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Precalificación</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Estado Expediente</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Fecha</th>
                <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Responsable</th>
                <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-[#00B8FF]/12">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={16} className="py-10 text-center text-slate-500">
                    No hay solicitudes que coincidan con los criterios actuales.
                  </td>
                </tr>
              ) : (
                filtered.map((app) => {
                  const isContractApproved = [
                    'APROBADA',
                    'APROBADA_CONDICIONADA',
                    'FORMALIZADA',
                    'DESEMBOLSADA',
                  ].includes(app.status);
                  return (
                    <tr
                      key={app.id}
                      className="axy-table-row"
                    >
                      <td className="py-2.5 px-3 font-mono font-medium whitespace-nowrap">
                        {app.applicationNumber}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                        {app.applicantDisplayName}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">{PRODUCT_LABELS[app.productCode]}</td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap">{app.currency}</td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right whitespace-nowrap">
                        {formatMoney(app.requestedAmount, app.currency)}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right font-semibold whitespace-nowrap">
                        {app.latestScore !== null && app.latestScore !== undefined ? `${app.latestScore}/100` : '—'}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">{app.latestRiskBand ?? '—'}</td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right whitespace-nowrap">
                        {app.recommendedAmount !== null && app.recommendedAmount !== undefined
                          ? formatMoney(app.recommendedAmount, app.currency)
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right whitespace-nowrap">
                        {formatRatePct(app.recommendedRateMonthly)}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right whitespace-nowrap">
                        {app.recommendedTermMonths ? `${app.recommendedTermMonths} m` : '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right whitespace-nowrap">
                        {app.recommendedInstallment ? formatMoney(app.recommendedInstallment, app.currency) : '—'}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={
                            app.prequalificationStatus === 'PREOFERTA'
                              ? 'text-[#0066FF] dark:text-[#00D1FF] font-semibold'
                              : 'text-amber-700 dark:text-amber-400 font-medium'
                          }
                        >
                          {app.prequalificationStatus
                            ? SCORING_STATUS_LABELS[app.prequalificationStatus]
                            : 'Sin ejecutar'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={
                            isContractApproved
                              ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                              : 'text-slate-700 dark:text-slate-300 font-medium'
                          }
                        >
                          {APPLICATION_STATUS_LABELS[app.status]}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-500">
                        {formatTimestamp(app.createdAt)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {app.assignedToName || app.createdByName || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedApplicationId(app.id)}
                            className="axy-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-slate-700 dark:text-slate-200 cursor-pointer"
                          >
                            <Eye className="w-3 h-3" />
                            Ver Solicitud
                          </button>
                          {canEditApplicationRecord(app.status, userProfile?.role) && (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditingApp(app)}
                                className="axy-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-[#0052CC] dark:text-[#00D1FF] font-semibold cursor-pointer"
                                title="Actualizar datos de la solicitud y reevaluar con Motor V2"
                              >
                                <Pencil className="w-3 h-3" />
                                Editar
                              </button>
                              <button
                                type="button"
                                disabled={reevaluatingAppId === app.id || !userProfile}
                                onClick={async () => {
                                  if (!userProfile) return;
                                  const cust = customers.find((c) => c.id === app.customerId) ?? null;
                                  setReevaluatingAppId(app.id);
                                  setRouteFeedback(null);
                                  try {
                                    const res = await reevaluateApplicationWithEngine({
                                      application: app,
                                      customer: cust,
                                      policy: activeOrTestPolicy,
                                      user: userProfile,
                                    });
                                    setRouteFeedback({
                                      type: 'ok',
                                      msg: `${app.applicationNumber} reevaluada por Motor V2: Score ${
                                        res.previousScore !== null ? `${res.previousScore} → ` : ''
                                      }${res.newScoring.totalScore}/100 (${
                                        SCORING_STATUS_LABELS[res.newScoring.status]
                                      } · Monto rec.: ${formatMoney(res.newScoring.recommendedAmount, app.currency)}).`,
                                    });
                                  } catch (err) {
                                    setRouteFeedback({
                                      type: 'err',
                                      msg: formatUserFacingError(
                                        err,
                                        'No se pudo reevaluar la solicitud con el Motor de Decisiones.'
                                      ),
                                    });
                                  } finally {
                                    setReevaluatingAppId(null);
                                  }
                                }}
                                className="axy-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                                title="Reevaluar solicitud nuevamente con Motor V2"
                              >
                                <Cpu className={`w-3 h-3 ${reevaluatingAppId === app.id ? 'animate-spin' : ''}`} />
                                {reevaluatingAppId === app.id ? 'Evaluando...' : 'Reevaluar'}
                              </button>
                            </>
                          )}
                          {app.status === 'RECIBIDA' &&
                            rbac.isInternalStaff &&
                            !rbac.isReadOnlyAuditor &&
                            (() => {
                              const fullAmountApproved =
                                app.prequalificationStatus === 'PREOFERTA' &&
                                (app.recommendedAmount ?? 0) >= app.requestedAmount;
                              const cust = customers.find((c) => c.id === app.customerId) ?? null;

                              if (fullAmountApproved) {
                                return (
                                  <button
                                    type="button"
                                    disabled={routingAppId === app.id || !userProfile}
                                    onClick={async () => {
                                      if (!userProfile) return;
                                      setRoutingAppId(app.id);
                                      setRoutingStage('VALIDATING');
                                      setRouteFeedback(null);
                                      setValidationAlert(null);
                                      try {
                                        const validation = await validateApplicationPreEvaluationInFirestore({
                                          application: app,
                                          user: userProfile,
                                        });
                                        if (!validation.canProceed) {
                                          setValidationAlert(validation);
                                          return;
                                        }
                                        setRoutingStage('TRANSITIONING');
                                        await advanceApplicationToEvaluation({
                                          application: app,
                                          customer: cust,
                                          policy: activeOrTestPolicy,
                                          user: userProfile,
                                          validatedResult: validation,
                                        });
                                        setSelectedApplicationId(app.id);
                                        setRouteFeedback({
                                          type: 'ok',
                                          msg: `${app.applicationNumber} validada en Firestore, aprobada por el Motor de Decisiones (${formatMoney(app.requestedAmount, app.currency)}) y enviada directamente a Evaluación.${validation.warnings.length > 0 ? ` (${validation.warnings.length} advertencia(s) informativa(s) de perfil).` : ''}`,
                                        });
                                      } catch (err) {
                                        if (err instanceof PreEvaluationValidationError) {
                                          setValidationAlert(err.validation);
                                        } else {
                                          setRouteFeedback({
                                            type: 'err',
                                            msg: formatUserFacingError(
                                              err,
                                              'No se pudo enviar la solicitud a Evaluación.'
                                            ),
                                          });
                                        }
                                      } finally {
                                        setRoutingAppId(null);
                                        setRoutingStage(null);
                                      }
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
                                  >
                                    <ArrowRight className="w-3 h-3" />
                                    {routingAppId === app.id
                                      ? routingStage === 'VALIDATING'
                                        ? 'Validando...'
                                        : 'Pasando...'
                                      : 'Pasar a Evaluación'}
                                  </button>
                                );
                              }

                              return (
                                <button
                                  type="button"
                                  disabled={routingAppId === app.id || !userProfile}
                                  onClick={() => {
                                    const suggested =
                                      app.recommendedAmount && app.recommendedAmount > 0
                                        ? app.recommendedAmount
                                        : Math.round(app.requestedAmount * 0.7);
                                    setAlternateModalError(null);
                                    setAlternateModalApp(app);
                                    setAlternateAmountInput(String(suggested));
                                    setAlternateNoteInput('');
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer disabled:opacity-50"
                                >
                                  <ShieldAlert className="w-3 h-3" />
                                  Autorizar Otro Monto
                                </button>
                              );
                            })()}
                          {rbac.canAccessSection('evaluation') &&
                            ['EN_EVALUACION', 'DEVUELTA'].includes(app.status) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedApplicationId(app.id);
                                  setActiveSection('evaluation');
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded axy-brand-gradient text-white font-medium cursor-pointer"
                              >
                                <UserCheck className="w-3 h-3" />
                                {rbac.hasPermission('EDIT_VERIFIED_FINANCIALS') || rbac.hasPermission('RISK_SIGN_OFF')
                                  ? 'Evaluar'
                                  : 'Revisar'}
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {activeTab === 'emails' && (
        <div className="space-y-4">
          <div className="axy-surface p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5">
              <p className="font-semibold text-slate-900 dark:text-white">
                Registro Automático de Emails por Cambio de Estado (Cloud Functions + Outbox)
              </p>
              <p className="text-slate-500 dark:text-slate-400">
                Cada cambio de estado en solicitudes o entrada a Pendiente de Firma genera el correo HTML/texto y lo despacha vía SMTP o cola de Firebase Cloud Functions.
              </p>
            </div>
            <select
              value={emailEventFilter}
              onChange={(e) => setEmailEventFilter(e.target.value)}
              className="axy-input px-2.5 py-1.5 text-slate-900 dark:text-white"
            >
              <option value="ALL">Todos los eventos</option>
              {Object.entries(EMAIL_EVENT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          {emailFeedback && (
            <div className="axy-surface-tonal p-3 rounded-xl text-xs text-slate-700 dark:text-slate-200">
              {emailFeedback}
            </div>
          )}

          <div className="axy-surface rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="axy-table-head text-slate-600 dark:text-slate-300">
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Solicitud</th>
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Cliente</th>
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Correo Destino</th>
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Evento / Estado</th>
                    <th className="py-2.5 px-3 font-semibold">Asunto</th>
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Canal / Estado Envío</th>
                    <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Fecha</th>
                    <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/80 dark:divide-[#00B8FF]/12">
                  {sortedEmails.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-500">
                        No hay notificaciones email registradas todavía.
                      </td>
                    </tr>
                  ) : (
                    sortedEmails.map((em) => {
                      const statusLabel =
                        em.status === 'SENT'
                          ? 'Enviado'
                          : em.status === 'PENDING_CLOUD_FUNCTION'
                          ? 'En cola Cloud Function'
                          : em.status === 'QUEUED'
                          ? 'Encolado'
                          : em.status === 'SKIPPED_NO_EMAIL'
                          ? 'Sin email en cliente'
                          : 'Error SMTP';
                      const statusCls =
                        em.status === 'SENT'
                          ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                          : em.status === 'FAILED' || em.status === 'SKIPPED_NO_EMAIL'
                          ? 'text-rose-700 dark:text-rose-400 font-semibold'
                          : 'text-amber-700 dark:text-amber-400 font-semibold';
                      return (
                        <tr key={em.id} className="axy-table-row">
                          <td className="py-2.5 px-3 font-mono font-medium whitespace-nowrap">
                            {em.applicationNumber}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">{em.recipientName}</td>
                          <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                            {em.recipientEmail || '—'}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {EMAIL_EVENT_LABELS[em.eventCode]}
                          </td>
                          <td className="py-2.5 px-3 max-w-[260px] truncate">{em.subject}</td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className={statusCls}>{statusLabel}</span>
                          </td>
                          <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-500">
                            {formatTimestamp(em.sentAt || em.createdAt)}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setPreviewEmail(em)}
                                className="axy-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-slate-700 dark:text-slate-200 cursor-pointer"
                              >
                                <Eye className="w-3 h-3" />
                                Vista previa
                              </button>
                              {rbac.isInternalStaff &&
                                !rbac.isReadOnlyAuditor &&
                                em.recipientEmail &&
                                em.status !== 'SENT' && (
                                  <button
                                    type="button"
                                    disabled={retryingId === em.id}
                                    onClick={async () => {
                                      setRetryingId(em.id);
                                      setEmailFeedback(null);
                                      try {
                                        const updated = await retryCustomerEmailNotification(em);
                                        setEmailFeedback(
                                          updated.status === 'SENT'
                                            ? `Correo enviado a ${updated.recipientEmail} (${updated.applicationNumber}).`
                                            : updated.errorMessage || 'Actualizado en cola.'
                                        );
                                      } catch (err) {
                                        setEmailFeedback(
                                          err instanceof Error ? err.message : 'Error reintentando envío.'
                                        );
                                      } finally {
                                        setRetryingId(null);
                                      }
                                    }}
                                    className="axy-btn-primary inline-flex items-center gap-1 px-2.5 py-1 cursor-pointer disabled:opacity-50"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                    {retryingId === em.id ? 'Enviando...' : 'Reintentar'}
                                  </button>
                                )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {previewEmail && (
        <div
          className="fixed inset-0 z-50 bg-[#030816]/65 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => setPreviewEmail(null)}
        >
          <div
            className="axy-panel-in axy-surface relative w-full max-w-2xl rounded-2xl border border-[var(--axy-border-strong)] overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="axy-infinity-line" />
            <div className="px-5 py-3.5 border-b border-[var(--axy-border)] flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                  {previewEmail.subject}
                </p>
                <p className="text-xs text-slate-500">
                  Para: {previewEmail.recipientEmail || 'Sin correo'} · {EMAIL_EVENT_LABELS[previewEmail.eventCode]}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewEmail(null)}
                className="axy-btn-secondary p-1.5 text-slate-500 cursor-pointer"
                aria-label="Cerrar vista previa"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 max-h-[70vh] overflow-y-auto bg-[var(--axy-surface-tonal)]">
              <iframe
                title="Vista previa del email"
                sandbox=""
                srcDoc={previewEmail.bodyHtml}
                className="w-full h-[380px] rounded-xl border border-[var(--axy-border)] bg-white"
              />
            </div>
          </div>
        </div>
      )}

      {alternateModalApp && (
        <div
          className="fixed inset-0 z-50 bg-[#030816]/65 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => setAlternateModalApp(null)}
        >
          <div
            className="axy-panel-in axy-surface relative w-full max-w-lg rounded-2xl border border-[var(--axy-border-strong)] overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="axy-infinity-line" />
            <div className="px-5 py-4 border-b border-[var(--axy-border)] flex items-center justify-between">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Autorizar Evaluación con Otro Monto
                </h3>
                <p className="text-xs text-slate-500">
                  {alternateModalApp.applicationNumber} · {alternateModalApp.applicantDisplayName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAlternateModalApp(null)}
                className="axy-btn-secondary p-1.5 text-slate-500 cursor-pointer"
                aria-label="Cerrar autorización"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 space-y-1">
                <p className="font-semibold">
                  El monto solicitado ({formatMoney(alternateModalApp.requestedAmount, alternateModalApp.currency)}) no fue aprobado íntegramente por el Motor de Decisiones.
                </p>
                <p>
                  Dictamen actual: <strong>{alternateModalApp.prequalificationStatus ? SCORING_STATUS_LABELS[alternateModalApp.prequalificationStatus] : 'Sin oferta'}</strong> · Monto sugerido por Motor:{' '}
                  <strong className="font-mono">{formatMoney(alternateModalApp.recommendedAmount ?? 0, alternateModalApp.currency)}</strong>
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Monto Autorizado para Re-evaluación en Motor ({alternateModalApp.currency}) *
                </label>
                <input
                  type="number"
                  min={1}
                  value={alternateAmountInput}
                  onChange={(e) => setAlternateAmountInput(e.target.value)}
                  className="axy-input w-full px-3 py-2 font-mono text-sm font-semibold text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nota de Autorización
                </label>
                <textarea
                  rows={2}
                  value={alternateNoteInput}
                  onChange={(e) => setAlternateNoteInput(e.target.value)}
                  placeholder="Ej. Autorizado evaluar contrapropuesta ajustada a capacidad de pago..."
                  className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>

              {alternateModalError && (
                <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 text-xs">
                  {alternateModalError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setAlternateModalError(null);
                    setAlternateModalApp(null);
                  }}
                  className="axy-btn-secondary px-3.5 py-2 text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={routingAppId === alternateModalApp.id || Number(alternateAmountInput) <= 0 || !userProfile}
                  onClick={async () => {
                    const targetApp = alternateModalApp;
                    const cust = customers.find((c) => c.id === targetApp.customerId) ?? null;
                    if (!userProfile) return;
                    const nextAmt = Number(alternateAmountInput);
                    if (!Number.isFinite(nextAmt) || nextAmt <= 0) return;

                    setRoutingAppId(targetApp.id);
                    setRoutingStage('VALIDATING');
                    setAlternateModalError(null);
                    setRouteFeedback(null);
                    setValidationAlert(null);
                    try {
                      const validation = await validateApplicationPreEvaluationInFirestore({
                        application: targetApp,
                        user: userProfile,
                      });
                      if (!validation.canProceed) {
                        setAlternateModalApp(null);
                        setAlternateModalError(null);
                        setValidationAlert(validation);
                        return;
                      }
                      setRoutingStage('TRANSITIONING');
                      await advanceApplicationToEvaluation({
                        application: targetApp,
                        customer: cust,
                        policy: activeOrTestPolicy,
                        user: userProfile,
                        alternateAmount: nextAmt,
                        authorizationNote: alternateNoteInput.trim(),
                        validatedResult: validation,
                      });
                      setAlternateModalApp(null);
                      setAlternateModalError(null);
                      setSelectedApplicationId(targetApp.id);
                      setRouteFeedback({
                        type: 'ok',
                        msg: `Se validó en Firestore y se autorizó re-evaluar ${targetApp.applicationNumber} por ${formatMoney(nextAmt, targetApp.currency)} con el Motor de Decisiones; pasó a Evaluación.`,
                      });
                    } catch (err) {
                      if (err instanceof PreEvaluationValidationError) {
                        setAlternateModalApp(null);
                        setAlternateModalError(null);
                        setValidationAlert(err.validation);
                      } else {
                        const errMsg = formatUserFacingError(
                          err,
                          'Error autorizando monto alternativo.'
                        );
                        setAlternateModalError(errMsg);
                        setRouteFeedback({
                          type: 'err',
                          msg: errMsg,
                        });
                      }
                    } finally {
                      setRoutingAppId(null);
                      setRoutingStage(null);
                    }
                  }}
                  className="px-4 py-2 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {routingAppId === alternateModalApp.id
                    ? routingStage === 'VALIDATING'
                      ? 'Validando en Firestore...'
                      : 'Evaluando con Motor...'
                    : 'Autorizar y Evaluar en Motor'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingApp && (
        <ApplicationEditModal
          application={editingApp}
          onClose={() => setEditingApp(null)}
          onSaved={(res) => {
            setRouteFeedback({
              type: 'ok',
              msg: res.newScoring
                ? `${res.application.applicationNumber} actualizada (${
                    res.changedFields.join(', ') || 'confirmada'
                  }) y reevaluada por Motor V2: Score ${
                    res.previousScore !== null ? `${res.previousScore} → ` : ''
                  }${res.newScoring.totalScore}/100 (${SCORING_STATUS_LABELS[res.newScoring.status]} · Rec.: ${formatMoney(
                    res.newScoring.recommendedAmount,
                    res.application.currency
                  )}).`
                : `${res.application.applicationNumber} actualizada correctamente (${
                    res.changedFields.join(', ') || 'sin cambios estructurales'
                  }).`,
            });
          }}
        />
      )}

      <ApplicationDetailDrawer
        applicationId={selectedApplicationId}
        onClose={() => setSelectedApplicationId(null)}
      />
    </div>
  );
}
