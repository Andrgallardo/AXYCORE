import React, { useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Bell, CheckCheck, CheckCircle2, Cpu, Eye, Link2, Mail, MessageSquareText, Radio, RefreshCw, Search, Send, SlidersHorizontal, UserCheck, X } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { ApplicationDetailDrawer, type ApplicationDrawerTab } from '../components/ApplicationDetailDrawer';
import { ApplicationEditModal } from '../components/ApplicationEditModal';
import { ConditionAdjustmentModal } from '../components/ConditionAdjustmentModal';
import { PreEvaluationValidationAlert } from '../components/PreEvaluationValidationAlert';
import { EMAIL_EVENT_LABELS } from '../engine/emailTemplates';
import { PAYMENT_FREQUENCY_LABELS } from '../engine/integratedCreditEngine';
import {
  CLIENT_SERVICE_REQUEST_STATUS_LABELS,
  PUBLIC_CREDIT_APPLICATION_STATUS_LABELS,
  getServiceRequestCatalogItem,
} from '../engine/externalPortalEngine';
import {
  PreEvaluationValidationError,
  type PreEvaluationValidationResult,
} from '../engine/preEvaluationValidation';
import {
  advanceApplicationToEvaluation,
  retryCustomerEmailNotification,
  validateApplicationPreEvaluationInFirestore,
} from '../services/axycoreStore';
import {
  convertPublicCreditApplicationToPipeline,
  discardPublicCreditApplication,
  respondToClientServiceRequest,
} from '../services/externalPortalService';
import type {
  ApplicationRecord,
  ClientServiceRequestRecord,
  ClientServiceRequestStatus,
  EmailNotificationRecord,
  PublicCreditApplicationRecord,
  PublicCreditApplicationStatus,
} from '../types/axycore';
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
    clientServiceRequests,
    publicCreditApplications,
    rbac,
  } = useAxyCore();

  const [activeTab, setActiveTab] = useState<'applications' | 'public_web' | 'client_requests' | 'emails'>('applications');
  const [pubAppStatusFilter, setPubAppStatusFilter] = useState<'ALL' | PublicCreditApplicationStatus>('ALL');
  const [selectedPublicApp, setSelectedPublicApp] = useState<PublicCreditApplicationRecord | null>(null);
  const [convertingPubAppId, setConvertingPubAppId] = useState<string | null>(null);
  const [discardingPubAppId, setDiscardingPubAppId] = useState<string | null>(null);
  const [pubAppFeedback, setPubAppFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [reqStatusFilter, setReqStatusFilter] = useState<'ALL' | ClientServiceRequestStatus>('ALL');
  const [selectedServiceReq, setSelectedServiceReq] = useState<ClientServiceRequestRecord | null>(null);
  const [serviceReplyText, setServiceReplyText] = useState('');
  const [serviceReplyStatus, setServiceReplyStatus] = useState<ClientServiceRequestStatus>('COMPLETADA');
  const [serviceLinkCustomerId, setServiceLinkCustomerId] = useState('');
  const [savingServiceReply, setSavingServiceReply] = useState(false);
  const [serviceReplyFeedback, setServiceReplyFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [verdictFilter, setVerdictFilter] = useState<'ALL' | 'NOT_QUALIFIES' | 'QUALIFIES' | 'IN_EVALUATION'>('ALL');
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
  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [drawerInitialTab, setDrawerInitialTab] = useState<ApplicationDrawerTab>('overview');
  const [adjustModalAppId, setAdjustModalAppId] = useState<string | null>(null);

  const editingApp = useMemo(
    () => (editingAppId ? applications.find((a) => a.id === editingAppId) ?? null : null),
    [applications, editingAppId]
  );

  const adjustModalApp = useMemo(
    () => (adjustModalAppId ? applications.find((a) => a.id === adjustModalAppId) ?? null : null),
    [applications, adjustModalAppId]
  );

  const doesAppQualify = (app: ApplicationRecord): boolean => {
    if (
      app.decisionQualificationStatus === 'CALIFICA_AUTO_EVALUACION' ||
      app.decisionQualificationStatus === 'REEVALUADA_APROBADA_EVALUACION'
    ) {
      return true;
    }
    if (app.requiresHumanIntervention) return false;
    return (
      app.prequalificationStatus === 'PREOFERTA' &&
      (app.recommendedAmount ?? 0) >= app.requestedAmount
    );
  };

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

  const pendingPublicAppsCount = useMemo(
    () => publicCreditApplications.filter((a) => a.status === 'RECIBIDA_PUBLICA').length,
    [publicCreditApplications]
  );

  const filteredPublicApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...publicCreditApplications]
      .filter((a) => {
        if (pubAppStatusFilter !== 'ALL' && a.status !== pubAppStatusFilter) return false;
        if (!q) return true;
        return (
          a.trackingNumber.toLowerCase().includes(q) ||
          a.applicantFullName.toLowerCase().includes(q) ||
          a.documentNumber.toLowerCase().includes(q) ||
          a.phone.toLowerCase().includes(q) ||
          (a.email || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => String(b.trackingNumber || '').localeCompare(String(a.trackingNumber || '')));
  }, [publicCreditApplications, pubAppStatusFilter, search]);

  const handleConvertPublicApp = async (pubApp: PublicCreditApplicationRecord) => {
    if (!userProfile) return;
    setConvertingPubAppId(pubApp.id);
    setPubAppFeedback(null);
    setRouteFeedback(null);
    try {
      const res = await convertPublicCreditApplicationToPipeline({
        publicApp: pubApp,
        policy: activeOrTestPolicy,
        staffUser: userProfile,
      });
      const autoSentToEval = res.application.status === 'EN_EVALUACION';
      setSelectedApplicationId(res.application.id);
      if (autoSentToEval && rbac.canAccessSection('evaluation')) {
        setRouteFeedback({
          type: 'ok',
          msg: `${res.application.applicationNumber} (${pubApp.applicantFullName}) calificó en el Motor V2 (Score ${res.application.latestScore ?? '—'}/100) y fue enviada directo a Evaluación.`,
        });
        setActiveSection('evaluation');
        return;
      }
      const msg = autoSentToEval
        ? `${res.application.applicationNumber} calificó en el Motor V2 y pasó directo a Evaluación.`
        : `${res.application.applicationNumber} evaluada por el Motor V2 (Score ${res.application.latestScore ?? '—'}/100): No califica con las condiciones solicitadas. Usa «Cambiar Condiciones» para ajustarla.`;
      setPubAppFeedback({ type: 'ok', msg });
      setRouteFeedback({ type: 'ok', msg });
      setActiveTab('applications');
    } catch (err) {
      const errMsg = formatUserFacingError(
        err,
        'No se pudo ingresar la solicitud pública al Motor de Decisiones V2.'
      );
      setPubAppFeedback({ type: 'err', msg: errMsg });
      setRouteFeedback({ type: 'err', msg: errMsg });
    } finally {
      setConvertingPubAppId(null);
    }
  };

  const handleDiscardPublicApp = async (pubApp: PublicCreditApplicationRecord) => {
    if (!userProfile) return;
    setDiscardingPubAppId(pubApp.id);
    setPubAppFeedback(null);
    try {
      await discardPublicCreditApplication({
        publicAppId: pubApp.id,
        staffUser: userProfile,
        reviewNotes: 'Descartada desde bandeja de Solicitudes Públicas Web.',
      });
      setPubAppFeedback({
        type: 'ok',
        msg: `Solicitud pública ${pubApp.trackingNumber} marcada como descartada.`,
      });
    } catch (err) {
      setPubAppFeedback({
        type: 'err',
        msg: formatUserFacingError(err, 'No se pudo descartar la solicitud pública.'),
      });
    } finally {
      setDiscardingPubAppId(null);
    }
  };

  const pendingServiceReqCount = useMemo(
    () =>
      clientServiceRequests.filter(
        (r) => r.status === 'PENDIENTE' || r.status === 'EN_PROCESO'
      ).length,
    [clientServiceRequests]
  );

  const filteredServiceRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...clientServiceRequests]
      .filter((r) => {
        if (reqStatusFilter !== 'ALL' && r.status !== reqStatusFilter) return false;
        if (!q) return true;
        return (
          r.ticketNumber.toLowerCase().includes(q) ||
          r.clientName.toLowerCase().includes(q) ||
          r.clientEmail.toLowerCase().includes(q) ||
          r.subject.toLowerCase().includes(q) ||
          r.details.toLowerCase().includes(q) ||
          (r.documentNumber || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => String(b.ticketNumber || '').localeCompare(String(a.ticketNumber || '')));
  }, [clientServiceRequests, reqStatusFilter, search]);

  const openServiceRequestReply = (req: ClientServiceRequestRecord) => {
    setSelectedServiceReq(req);
    setServiceReplyText(req.staffResponse || '');
    setServiceReplyStatus(req.status === 'PENDIENTE' ? 'COMPLETADA' : req.status);
    setServiceLinkCustomerId(req.customerId || '');
    setServiceReplyFeedback(null);
  };

  const handleSaveServiceReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedServiceReq || !userProfile) return;
    if (!serviceReplyText.trim()) {
      setServiceReplyFeedback({
        type: 'err',
        msg: 'Escribe una respuesta oficial para el cliente antes de actualizar la gestión.',
      });
      return;
    }
    setSavingServiceReply(true);
    setServiceReplyFeedback(null);
    try {
      await respondToClientServiceRequest({
        requestId: selectedServiceReq.id,
        status: serviceReplyStatus,
        staffResponse: serviceReplyText.trim(),
        staffUser: userProfile,
        linkCustomerId: serviceLinkCustomerId || undefined,
        clientUidToLink: serviceLinkCustomerId ? selectedServiceReq.clientUid : undefined,
      });
      setServiceReplyFeedback({
        type: 'ok',
        msg: serviceLinkCustomerId
          ? `Gestión ${selectedServiceReq.ticketNumber} respondida y expediente vinculado a la cuenta del cliente.`
          : `Gestión ${selectedServiceReq.ticketNumber} actualizada correctamente.`,
      });
      setSelectedServiceReq(null);
    } catch (err) {
      setServiceReplyFeedback({
        type: 'err',
        msg: formatUserFacingError(err, 'No se pudo guardar la respuesta de la gestión.'),
      });
    } finally {
      setSavingServiceReply(false);
    }
  };

  const handleSendQualifiedToEvaluation = async (app: ApplicationRecord) => {
    if (!userProfile) return;
    const cust = customers.find((c) => c.id === app.customerId) ?? null;
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
      if (rbac.canAccessSection('evaluation')) {
        setActiveSection('evaluation');
        return;
      }
      setRouteFeedback({
        type: 'ok',
        msg: `${app.applicationNumber} calificada por Motor V2 y enviada directo a Evaluación.`,
      });
    } catch (err) {
      if (err instanceof PreEvaluationValidationError) {
        setValidationAlert(err.validation);
      } else {
        setRouteFeedback({
          type: 'err',
          msg: formatUserFacingError(err, 'No se pudo enviar la solicitud a Evaluación.'),
        });
      }
    } finally {
      setRoutingAppId(null);
      setRoutingStage(null);
    }
  };

  const pendingPublicApps = useMemo(
    () =>
      publicCreditApplications
        .filter((a) => a.status === 'RECIBIDA_PUBLICA')
        .sort((a, b) => String(b.trackingNumber || '').localeCompare(String(a.trackingNumber || ''))),
    [publicCreditApplications]
  );

  const verdictCounts = useMemo(() => {
    let notQualifies = 0;
    let qualifies = 0;
    let inEval = 0;
    for (const a of applications) {
      if (a.status === 'EN_EVALUACION') inEval += 1;
      if (doesAppQualify(a)) qualifies += 1;
      else notQualifies += 1;
    }
    return { total: applications.length, notQualifies, qualifies, inEval };
  }, [applications]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return applications
      .filter((a) => {
        if (onlyUrgent && !urgentAppIds.has(a.id)) return false;
        if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
        if (verdictFilter === 'NOT_QUALIFIES' && doesAppQualify(a)) return false;
        if (verdictFilter === 'QUALIFIES' && !doesAppQualify(a)) return false;
        if (verdictFilter === 'IN_EVALUATION' && a.status !== 'EN_EVALUACION') return false;
        if (!q) return true;
        return (
          a.applicationNumber.toLowerCase().includes(q) ||
          a.applicantDisplayName.toLowerCase().includes(q) ||
          a.fileNumber.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.applicationNumber.localeCompare(a.applicationNumber));
  }, [applications, search, statusFilter, verdictFilter, onlyUrgent, urgentAppIds]);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header + Clean Search/Filter */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
            Solicitudes Recibidas
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Todas las solicitudes llegan con el Motor de Decisiones V2 ejecutado. Si califica pasa directo a Evaluación; si no califica puedes cambiar condiciones.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente o solicitud..."
              className="axy-input w-full min-h-[42px] pl-9 pr-3 py-2 text-slate-900 dark:text-white"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="axy-input min-h-[42px] px-3 py-2 text-slate-900 dark:text-white"
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

      {/* Scrollable Tab Bar (mobile-safe, never overflows screen) */}
      <div className="border-b border-slate-200/80 dark:border-[#00B8FF]/14 pb-2.5 text-xs">
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 dark:bg-[#08132B] border border-slate-200/80 dark:border-[#00B8FF]/16 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('applications')}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'applications'
                ? 'bg-[#0066FF] text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Solicitudes ({filtered.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('public_web')}
            className={`min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'public_web'
                ? 'bg-[#0066FF] text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            Enlace Público ({pendingPublicAppsCount > 0 ? `${pendingPublicAppsCount} nuevas` : publicCreditApplications.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('client_requests')}
            className={`min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'client_requests'
                ? 'bg-[#0066FF] text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <MessageSquareText className="w-3.5 h-3.5" />
            Gestiones ({pendingServiceReqCount > 0 ? `${pendingServiceReqCount} pend.` : clientServiceRequests.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('emails')}
            className={`min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              activeTab === 'emails'
                ? 'bg-[#0066FF] text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            Emails ({emailNotifications.length})
          </button>
        </div>

        {activeTab === 'emails' && (
          <p className="mt-2 text-slate-500 dark:text-slate-400">
            Envío automático por correo:{' '}
            <strong className="text-slate-800 dark:text-slate-200">
              {smtpConfigured ? 'Activo' : 'En cola institucional'}
            </strong>
          </p>
        )}
      </div>

      {activeTab === 'public_web' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Solicitudes Recibidas desde el Enlace Externo Público
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Solicitudes enviadas sin inicio de sesión desde el enlace único de tu institución. Al ingresarlas se crea o vincula el cliente y se ejecuta automáticamente el Motor de Decisiones V2 y Motor de Cálculo Financiero.
              </p>
            </div>
            <select
              value={pubAppStatusFilter}
              onChange={(e) =>
                setPubAppStatusFilter(e.target.value as 'ALL' | PublicCreditApplicationStatus)
              }
              className="axy-input px-3 py-1.5 text-xs text-slate-900 dark:text-white"
            >
              <option value="ALL">Todos los estados ({publicCreditApplications.length})</option>
              <option value="RECIBIDA_PUBLICA">Pendientes de ingreso</option>
              <option value="INGRESADA_MOTOR">Ingresadas al Motor V2</option>
              <option value="DESCARTADA">Descartadas</option>
            </select>
          </div>

          {pubAppFeedback && (
            <div
              className={`p-3 rounded-xl border text-xs ${
                pubAppFeedback.type === 'ok'
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                  : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-200'
              }`}
            >
              {pubAppFeedback.msg}
            </div>
          )}

          {filteredPublicApps.length === 0 ? (
            <div className="axy-surface rounded-2xl p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              Aún no hay solicitudes recibidas desde el formulario público web con los filtros actuales.
            </div>
          ) : (
            <>
              {/* Mobile Cards for Public Web Applications */}
              <div className="md:hidden space-y-3">
                {filteredPublicApps.map((pub) => (
                  <div
                    key={pub.id}
                    className="axy-surface rounded-2xl p-4 border border-slate-200/80 dark:border-[#00B8FF]/18 space-y-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-slate-900 dark:text-white truncate">
                          {pub.applicantFullName}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          {pub.trackingNumber} · {pub.documentNumber}
                        </p>
                      </div>
                      <span
                        className={`text-[11px] font-semibold shrink-0 ${
                          pub.status === 'INGRESADA_MOTOR'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : pub.status === 'DESCARTADA'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-[#E2B35E]'
                        }`}
                      >
                        {PUBLIC_CREDIT_APPLICATION_STATUS_LABELS[pub.status] || pub.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/70 dark:border-white/10">
                      <div>
                        <p className="text-[10px] text-slate-500">Solicitado</p>
                        <p className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                          {formatMoney(pub.requestedAmount, pub.currency)}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {pub.requestedTermMonths}m · {pub.paymentFrequency}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500">Ingresos / Gastos</p>
                        <p className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                          {formatMoney(pub.monthlyIncome, pub.currency)}
                        </p>
                        <p className="text-[10px] text-slate-500 font-mono tabular-nums">
                          Gtos: {formatMoney(pub.monthlyExpenses, pub.currency)}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-1">
                      {pub.status === 'RECIBIDA_PUBLICA' ? (
                        <>
                          <button
                            type="button"
                            disabled={convertingPubAppId === pub.id || rbac.isReadOnlyAuditor}
                            onClick={() => handleConvertPublicApp(pub)}
                            className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#0066FF] hover:bg-[#0052CC] text-white font-semibold cursor-pointer disabled:opacity-50"
                          >
                            <Cpu className="w-4 h-4" />
                            <span>
                              {convertingPubAppId === pub.id
                                ? 'Evaluando con Motor V2...'
                                : 'Ingresar y Evaluar Motor V2'}
                            </span>
                          </button>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedPublicApp(pub)}
                              className="min-h-[40px] inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/15 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Detalle
                            </button>
                            <button
                              type="button"
                              disabled={discardingPubAppId === pub.id || rbac.isReadOnlyAuditor}
                              onClick={() => handleDiscardPublicApp(pub)}
                              className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/15 text-slate-600 dark:text-slate-300 hover:text-rose-500 font-semibold cursor-pointer disabled:opacity-50"
                            >
                              {discardingPubAppId === pub.id ? '...' : 'Descartar'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedPublicApp(pub)}
                            className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/15 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Detalle
                          </button>
                          {pub.convertedApplicationId && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedApplicationId(pub.convertedApplicationId || null);
                                setActiveTab('applications');
                              }}
                              className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-xl bg-[#0066FF]/10 text-[#0052CC] dark:text-[#00D1FF] font-semibold cursor-pointer"
                            >
                              Expediente
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table for Public Web Applications */}
              <div className="hidden md:block axy-surface rounded-2xl overflow-hidden border border-slate-200/80 dark:border-[#00B8FF]/18">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-white/10 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#040C1E]/60">
                        <th className="py-3 px-4">Seguimiento</th>
                        <th className="py-3 px-4">Solicitante</th>
                        <th className="py-3 px-4">Monto y Plazo</th>
                        <th className="py-3 px-4">Ingresos / Gastos</th>
                        <th className="py-3 px-4">Estado</th>
                        <th className="py-3 px-4 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-white/[0.06]">
                      {filteredPublicApps.map((pub) => (
                        <tr key={pub.id} className="hover:bg-slate-50/60 dark:hover:bg-white/[0.02]">
                          <td className="py-3 px-4 font-mono font-bold text-[#0052CC] dark:text-[#00D1FF] whitespace-nowrap">
                            {pub.trackingNumber}
                            <span className="block text-[10px] text-slate-400 font-normal">
                              Portal {pub.portalCode}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900 dark:text-white">
                              {pub.applicantFullName}
                            </p>
                            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              {pub.applicantType === 'BUSINESS' ? 'Empresa' : 'Persona Física'} ·{' '}
                              {pub.documentType}: {pub.documentNumber} · Tel: {pub.phone}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {pub.email ? `${pub.email} · ` : ''}
                              Refs: {pub.references?.length ?? 0} · Adjuntos:{' '}
                              {pub.attachedDocuments?.length ?? 0}
                            </p>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <p className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                              {formatMoney(pub.requestedAmount, pub.currency)}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {pub.requestedTermMonths} meses · {pub.paymentFrequency} · Cuota est.{' '}
                              <span className="font-mono tabular-nums">
                                {formatMoney(pub.indicativeInstallment, pub.currency)}
                              </span>
                            </p>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap font-mono tabular-nums">
                            <p className="text-slate-800 dark:text-slate-200">
                              Ing: {formatMoney(pub.monthlyIncome, pub.currency)}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              Gtos: {formatMoney(pub.monthlyExpenses, pub.currency)}
                            </p>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`font-semibold ${
                                pub.status === 'INGRESADA_MOTOR'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : pub.status === 'DESCARTADA'
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-amber-600 dark:text-[#E2B35E]'
                              }`}
                            >
                              {PUBLIC_CREDIT_APPLICATION_STATUS_LABELS[pub.status] || pub.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedPublicApp(pub)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/15 hover:border-[#0066FF]/50 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Detalle</span>
                              </button>
                              {pub.status === 'RECIBIDA_PUBLICA' ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={convertingPubAppId === pub.id || rbac.isReadOnlyAuditor}
                                    onClick={() => handleConvertPublicApp(pub)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0066FF] hover:bg-[#0052CC] text-white font-semibold cursor-pointer disabled:opacity-50"
                                  >
                                    <Cpu className="w-3.5 h-3.5" />
                                    <span>
                                      {convertingPubAppId === pub.id
                                        ? 'Evaluando...'
                                        : 'Ingresar y Evaluar V2'}
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={discardingPubAppId === pub.id || rbac.isReadOnlyAuditor}
                                    onClick={() => handleDiscardPublicApp(pub)}
                                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/15 hover:border-rose-500/40 text-slate-600 dark:text-slate-300 hover:text-rose-500 font-semibold cursor-pointer disabled:opacity-50"
                                  >
                                    {discardingPubAppId === pub.id ? '...' : 'Descartar'}
                                  </button>
                                </>
                              ) : pub.convertedApplicationId ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedApplicationId(pub.convertedApplicationId || null);
                                    setActiveTab('applications');
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0066FF]/10 hover:bg-[#0066FF]/20 text-[#0052CC] dark:text-[#00D1FF] font-semibold cursor-pointer"
                                >
                                  <ArrowRight className="w-3.5 h-3.5" />
                                  <span>Expediente</span>
                                </button>
                              ) : (
                                <span className="text-[11px] text-slate-400">Archivada</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {activeTab === 'client_requests' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Gestiones Enviadas desde el Portal Externo de Clientes
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Responde cartas de saldo, estados de cuenta, acuerdos de prórroga o vincula cuentas de clientes existentes a su expediente.
              </p>
            </div>
            <select
              value={reqStatusFilter}
              onChange={(e) => setReqStatusFilter(e.target.value as 'ALL' | ClientServiceRequestStatus)}
              className="axy-input px-3 py-1.5 text-xs text-slate-900 dark:text-white"
            >
              <option value="ALL">Todos los estados ({clientServiceRequests.length})</option>
              <option value="PENDIENTE">Pendientes</option>
              <option value="EN_PROCESO">En proceso</option>
              <option value="COMPLETADA">Completadas</option>
              <option value="RECHAZADA">Rechazadas</option>
            </select>
          </div>

          {serviceReplyFeedback && (
            <div
              className={`p-3 rounded-xl border text-xs ${
                serviceReplyFeedback.type === 'ok'
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                  : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-200'
              }`}
            >
              {serviceReplyFeedback.msg}
            </div>
          )}

          {filteredServiceRequests.length === 0 ? (
            <div className="axy-surface rounded-2xl p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No hay gestiones de clientes registradas con los filtros actuales.
            </div>
          ) : (
            <div className="axy-surface rounded-2xl overflow-hidden border border-slate-200/80 dark:border-[#00B8FF]/18">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/10 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#040C1E]/60">
                      <th className="py-3 px-4">Ticket</th>
                      <th className="py-3 px-4">Cliente</th>
                      <th className="py-3 px-4">Tipo / Asunto</th>
                      <th className="py-3 px-4">Detalle</th>
                      <th className="py-3 px-4">Estado</th>
                      <th className="py-3 px-4 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 dark:divide-white/[0.06]">
                    {filteredServiceRequests.map((req) => {
                      const cat = getServiceRequestCatalogItem(req.requestType);
                      return (
                        <tr key={req.id} className="hover:bg-slate-50/60 dark:hover:bg-white/[0.02]">
                          <td className="py-3 px-4 font-mono font-bold text-[#0052CC] dark:text-[#00D1FF] whitespace-nowrap">
                            {req.ticketNumber}
                            {req.loanNumber && (
                              <span className="block text-[10px] text-slate-400 font-normal">
                                Préstamo {req.loanNumber}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900 dark:text-white">{req.clientName}</p>
                            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              {req.clientEmail}
                            </p>
                            {(req.documentNumber || req.contactPhone) && (
                              <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                                {req.documentNumber ? `Doc: ${req.documentNumber}` : ''}{' '}
                                {req.contactPhone ? `· Tel: ${req.contactPhone}` : ''}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-800 dark:text-slate-100">{cat.label}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">{req.subject}</p>
                          </td>
                          <td className="py-3 px-4 max-w-xs">
                            <p className="text-slate-600 dark:text-slate-300 line-clamp-2">{req.details}</p>
                            {req.staffResponse && (
                              <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-1 line-clamp-1">
                                Respuesta: {req.staffResponse}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`font-semibold ${
                                req.status === 'COMPLETADA'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : req.status === 'RECHAZADA'
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : req.status === 'EN_PROCESO'
                                  ? 'text-sky-600 dark:text-[#00D1FF]'
                                  : 'text-amber-600 dark:text-[#E2B35E]'
                              }`}
                            >
                              {CLIENT_SERVICE_REQUEST_STATUS_LABELS[req.status] || req.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openServiceRequestReply(req)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0066FF]/10 hover:bg-[#0066FF]/20 text-[#0052CC] dark:text-[#00D1FF] font-semibold cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>Gestionar</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === 'applications' && (
        <>
          {/* Direct 1-tap cards for new incoming Public Web Applications right inside Solicitudes Recibidas */}
          {pendingPublicApps.length > 0 && (
            <div className="axy-surface rounded-2xl p-4 border border-[#0066FF]/30 bg-[#0066FF]/[0.04] dark:bg-[#0066FF]/10 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
                  <p className="font-bold text-slate-900 dark:text-white">
                    {pendingPublicApps.length} nueva{pendingPublicApps.length === 1 ? '' : 's'} desde el Enlace Público
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPubAppStatusFilter('RECIBIDA_PUBLICA');
                    setActiveTab('public_web');
                  }}
                  className="text-[11px] font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer"
                >
                  Ver todas en Enlace Público
                </button>
              </div>
              <div className="space-y-2">
                {pendingPublicApps.slice(0, 3).map((pub) => (
                  <div
                    key={pub.id}
                    className="p-3 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200/80 dark:border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 dark:text-white truncate">
                        {pub.applicantFullName}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {pub.trackingNumber} · {formatMoney(pub.requestedAmount, pub.currency)} ·{' '}
                        {pub.requestedTermMonths}m {pub.paymentFrequency}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSelectedPublicApp(pub)}
                        className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-white/15 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                      >
                        Detalle
                      </button>
                      <button
                        type="button"
                        disabled={convertingPubAppId === pub.id || rbac.isReadOnlyAuditor}
                        onClick={() => handleConvertPublicApp(pub)}
                        className="flex-1 sm:flex-none min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#0066FF] hover:bg-[#0052CC] text-white font-semibold cursor-pointer disabled:opacity-50"
                      >
                        <Cpu className="w-3.5 h-3.5" />
                        {convertingPubAppId === pub.id ? 'Evaluando...' : 'Ingresar y Evaluar'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Verdict Filter Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'ALL', label: `Todas (${verdictCounts.total})` },
                  { id: 'NOT_QUALIFIES', label: `No Califican (${verdictCounts.notQualifies})` },
                  { id: 'QUALIFIES', label: `Califican (${verdictCounts.qualifies})` },
                  { id: 'IN_EVALUATION', label: `En Evaluación (${verdictCounts.inEval})` },
                ] as const
              ).map((chip) => {
                const active = verdictFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setVerdictFilter(chip.id)}
                    className={`min-h-[36px] px-3 py-1.5 rounded-xl border font-semibold transition-colors cursor-pointer ${
                      active
                        ? 'border-[#0066FF] bg-[#0066FF]/10 text-[#0052CC] dark:text-[#00D1FF]'
                        : 'border-slate-200 dark:border-white/12 bg-white dark:bg-[#08132B] text-slate-600 dark:text-slate-300 hover:border-slate-300'
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>

            {rbac.isInternalStaff && (inboxAlerts.length > 0 || desktopNotifPermission === 'default' || fcmStatus !== 'active') && (
              <div className="flex flex-wrap items-center gap-1.5">
                {inboxAlerts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOnlyUrgent((v) => !v)}
                    className={`min-h-[36px] px-3 py-1 rounded-xl border font-medium cursor-pointer ${
                      onlyUrgent
                        ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                        : 'border-slate-200 dark:border-white/12 bg-white dark:bg-[#08132B] text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {onlyUrgent ? 'Mostrar todas' : `Urgentes (${inboxAlerts.length})`}
                  </button>
                )}
                {unreadAlertCount > 0 && (
                  <button
                    type="button"
                    onClick={acknowledgeAllAlerts}
                    className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1 rounded-xl border border-slate-200 dark:border-white/12 bg-white dark:bg-[#08132B] text-slate-600 dark:text-slate-300 font-medium cursor-pointer"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Leído
                  </button>
                )}
                {desktopNotifPermission === 'default' && (
                  <button
                    type="button"
                    onClick={requestDesktopNotifications}
                    className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1 rounded-xl border border-slate-200 dark:border-white/12 bg-white dark:bg-[#08132B] text-slate-700 dark:text-slate-200 font-medium cursor-pointer"
                  >
                    <Bell className="w-3.5 h-3.5" />
                    Avisos
                  </button>
                )}
                {fcmStatus === 'active' ? (
                  <button
                    type="button"
                    onClick={disableFcmPush}
                    className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 font-medium cursor-pointer"
                    title={`Push activo en ${fcmActiveDevicesCount} dispositivo(s)`}
                  >
                    <Radio className="w-3.5 h-3.5" />
                    Push activo
                  </button>
                ) : (
                  fcmStatus !== 'unsupported' &&
                  fcmStatus !== 'vapid_missing' && (
                    <button
                      type="button"
                      disabled={fcmStatus === 'registering'}
                      onClick={enableFcmPush}
                      className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1 rounded-xl border border-slate-200 dark:border-white/12 bg-white dark:bg-[#08132B] text-slate-700 dark:text-slate-200 font-medium cursor-pointer disabled:opacity-50"
                      title={fcmError || 'Activar notificaciones push'}
                    >
                      <Radio className="w-3.5 h-3.5" />
                      {fcmStatus === 'registering' ? 'Activando…' : 'Activar push'}
                    </button>
                  )
                )}
              </div>
            )}
          </div>

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
                  className="min-h-[36px] px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                >
                  Ir a Evaluación
                </button>
              )}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="axy-surface rounded-2xl p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No hay solicitudes que coincidan con los filtros actuales.
            </div>
          ) : (
            <>
              {/* MOBILE CARD LIST (zero horizontal scroll, >=44px touch targets) */}
              <div className="md:hidden space-y-3">
                {filtered.map((app) => {
                  const qualifies = doesAppQualify(app);
                  const canAdjust =
                    rbac.isInternalStaff &&
                    !rbac.isReadOnlyAuditor &&
                    !qualifies &&
                    ['RECIBIDA', 'DEVUELTA'].includes(app.status);
                  const canDirectSendEval =
                    rbac.isInternalStaff &&
                    !rbac.isReadOnlyAuditor &&
                    qualifies &&
                    app.status === 'RECIBIDA';
                  const canOpenEval =
                    rbac.canAccessSection('evaluation') &&
                    ['EN_EVALUACION', 'DEVUELTA'].includes(app.status);

                  return (
                    <div
                      key={app.id}
                      className="axy-surface rounded-2xl p-4 border border-slate-200/85 dark:border-[#00B8FF]/18 space-y-3"
                    >
                      {/* Top row: Client + Ref */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-slate-900 dark:text-white truncate">
                            {app.applicantDisplayName}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {app.applicationNumber} · {PRODUCT_LABELS[app.productCode]}
                          </p>
                        </div>
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                          {APPLICATION_STATUS_LABELS[app.status]}
                        </span>
                      </div>

                      {/* Clear Decision Engine Verdict */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span
                          className={`inline-flex items-center gap-1.5 font-bold ${
                            qualifies
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {qualifies ? (
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                          ) : (
                            <AlertCircle className="w-4 h-4 shrink-0" />
                          )}
                          {qualifies ? 'Califica' : 'No Califica'}
                        </span>
                        <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          Score:{' '}
                          <strong className="text-slate-900 dark:text-white">
                            {app.latestScore !== null && app.latestScore !== undefined
                              ? `${app.latestScore}/100`
                              : '—'}
                          </strong>
                          {app.latestRiskBand ? ` · Banda ${app.latestRiskBand}` : ''}
                        </span>
                      </div>

                      {/* 3-Column Metrics */}
                      <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-slate-200/75 dark:border-white/10 text-xs">
                        <div>
                          <p className="text-[10px] text-slate-500">Solicitado</p>
                          <p className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                            {formatMoney(app.requestedAmount, app.currency)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500">Plazo / Frec.</p>
                          <p className="font-semibold text-slate-800 dark:text-slate-200">
                            {app.requestedTermMonths}m ·{' '}
                            {PAYMENT_FREQUENCY_LABELS[app.paymentFrequency]}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-slate-500">Cuota / Tasa</p>
                          <p className="font-mono font-semibold tabular-nums text-[#0052CC] dark:text-[#00D1FF]">
                            {app.recommendedInstallment
                              ? formatMoney(app.recommendedInstallment, app.currency)
                              : '—'}
                          </p>
                          <p className="text-[10px] font-mono text-slate-500">
                            {formatRatePct(app.recommendedRateMonthly)}/mes
                          </p>
                        </div>
                      </div>

                      {!qualifies &&
                        app.recommendedAmount !== null &&
                        app.recommendedAmount !== undefined &&
                        app.recommendedAmount > 0 &&
                        app.recommendedAmount < app.requestedAmount && (
                          <p className="text-[11px] text-amber-700 dark:text-amber-300">
                            Motor V2 sugiere hasta{' '}
                            <strong className="font-mono tabular-nums">
                              {formatMoney(app.recommendedAmount, app.currency)}
                            </strong>
                          </p>
                        )}

                      {/* Mobile Action Bar (>=44px touch targets) */}
                      <div className="flex items-center gap-2 pt-1">
                        {canAdjust ? (
                          <button
                            type="button"
                            onClick={() => setAdjustModalAppId(app.id)}
                            className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer"
                          >
                            <SlidersHorizontal className="w-4 h-4" />
                            Cambiar Condiciones
                          </button>
                        ) : canDirectSendEval ? (
                          <button
                            type="button"
                            disabled={routingAppId === app.id || !userProfile}
                            onClick={() => handleSendQualifiedToEvaluation(app)}
                            className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl axy-brand-gradient text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            <ArrowRight className="w-4 h-4" />
                            {routingAppId === app.id
                              ? routingStage === 'VALIDATING'
                                ? 'Validando...'
                                : 'Enviando...'
                              : 'Enviar a Evaluación'}
                          </button>
                        ) : canOpenEval ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedApplicationId(app.id);
                              setActiveSection('evaluation');
                            }}
                            className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl axy-brand-gradient text-white text-xs font-bold cursor-pointer"
                          >
                            <UserCheck className="w-4 h-4" />
                            Ir a Evaluación
                          </button>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => {
                            setDrawerInitialTab('overview');
                            setSelectedApplicationId(app.id);
                          }}
                          className={`${
                            canAdjust || canDirectSendEval || canOpenEval ? '' : 'flex-1'
                          } min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/15 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer`}
                        >
                          <Eye className="w-4 h-4" />
                          Detalle
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* DESKTOP STREAMLINED 6-COLUMN TABLE (scannable, no 16-column sprawl) */}
              <div className="hidden md:block axy-surface rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="axy-table-head text-slate-600 dark:text-slate-300">
                        <th className="py-3 px-4 font-semibold">Solicitud / Cliente</th>
                        <th className="py-3 px-4 font-semibold">Condiciones</th>
                        <th className="py-3 px-4 font-semibold">Motor V2</th>
                        <th className="py-3 px-4 font-semibold">Resultado</th>
                        <th className="py-3 px-4 font-semibold">Estado</th>
                        <th className="py-3 px-4 font-semibold text-right">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/80 dark:divide-[#00B8FF]/12">
                      {filtered.map((app) => {
                        const qualifies = doesAppQualify(app);
                        const canAdjust =
                          rbac.isInternalStaff &&
                          !rbac.isReadOnlyAuditor &&
                          !qualifies &&
                          ['RECIBIDA', 'DEVUELTA'].includes(app.status);
                        const canDirectSendEval =
                          rbac.isInternalStaff &&
                          !rbac.isReadOnlyAuditor &&
                          qualifies &&
                          app.status === 'RECIBIDA';
                        const canOpenEval =
                          rbac.canAccessSection('evaluation') &&
                          ['EN_EVALUACION', 'DEVUELTA'].includes(app.status);
                        const isContractApproved = [
                          'APROBADA',
                          'APROBADA_CONDICIONADA',
                          'FORMALIZADA',
                          'DESEMBOLSADA',
                        ].includes(app.status);

                        return (
                          <tr key={app.id} className="axy-table-row">
                            <td className="py-3 px-4">
                              <p className="font-semibold text-slate-900 dark:text-white">
                                {app.applicantDisplayName}
                              </p>
                              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                {app.applicationNumber} · {PRODUCT_LABELS[app.productCode]} ·{' '}
                                {formatTimestamp(app.createdAt)}
                              </p>
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap">
                              <p className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                                {formatMoney(app.requestedAmount, app.currency)}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                                {app.requestedTermMonths}m ·{' '}
                                {PAYMENT_FREQUENCY_LABELS[app.paymentFrequency]} ·{' '}
                                {app.recommendedInstallment
                                  ? `Cuota ${formatMoney(app.recommendedInstallment, app.currency)}`
                                  : formatRatePct(app.recommendedRateMonthly)}
                              </p>
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap">
                              <p className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                                {app.latestScore !== null && app.latestScore !== undefined
                                  ? `${app.latestScore}/100`
                                  : '—'}
                                {app.latestRiskBand ? ` · ${app.latestRiskBand}` : ''}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                                Tasa {formatRatePct(app.recommendedRateMonthly)}
                                {!qualifies &&
                                app.recommendedAmount &&
                                app.recommendedAmount < app.requestedAmount
                                  ? ` · Sug. ${formatMoney(app.recommendedAmount, app.currency)}`
                                  : ''}
                              </p>
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1.5 font-bold ${
                                  qualifies
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-amber-700 dark:text-amber-400'
                                }`}
                              >
                                {qualifies ? (
                                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                                ) : (
                                  <AlertCircle className="w-4 h-4 shrink-0" />
                                )}
                                {qualifies ? 'Califica' : 'No Califica'}
                              </span>
                            </td>

                            <td className="py-3 px-4 whitespace-nowrap">
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

                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                {canAdjust && (
                                  <button
                                    type="button"
                                    onClick={() => setAdjustModalAppId(app.id)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer"
                                  >
                                    <SlidersHorizontal className="w-3.5 h-3.5" />
                                    Cambiar Condiciones
                                  </button>
                                )}

                                {canDirectSendEval && (
                                  <button
                                    type="button"
                                    disabled={routingAppId === app.id || !userProfile}
                                    onClick={() => handleSendQualifiedToEvaluation(app)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
                                  >
                                    <ArrowRight className="w-3.5 h-3.5" />
                                    {routingAppId === app.id
                                      ? routingStage === 'VALIDATING'
                                        ? 'Validando...'
                                        : 'Enviando...'
                                      : 'Enviar a Evaluación'}
                                  </button>
                                )}

                                {canOpenEval && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedApplicationId(app.id);
                                      setActiveSection('evaluation');
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer"
                                  >
                                    <UserCheck className="w-3.5 h-3.5" />
                                    Ir a Evaluación
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => {
                                    setDrawerInitialTab('overview');
                                    setSelectedApplicationId(app.id);
                                  }}
                                  className="axy-btn-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-700 dark:text-slate-200 cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  Detalle
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
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

      {adjustModalApp && (
        <ConditionAdjustmentModal
          application={adjustModalApp}
          customer={customers.find((c) => c.id === adjustModalApp.customerId) ?? null}
          onClose={() => setAdjustModalAppId(null)}
          onSentToEvaluation={(appId, summaryMessage) => {
            setAdjustModalAppId(null);
            setSelectedApplicationId(appId);
            setRouteFeedback({ type: 'ok', msg: summaryMessage });
            if (rbac.canAccessSection('evaluation')) {
              setActiveSection('evaluation');
            }
          }}
          onSavedSimulation={(summaryMessage) => {
            setRouteFeedback({ type: 'ok', msg: summaryMessage });
          }}
        />
      )}

      {editingApp && (
        <ApplicationEditModal
          application={editingApp}
          onClose={() => setEditingAppId(null)}
          onSaved={(res) => {
            const diffSummary =
              res.fieldChanges.length > 0
                ? `${res.fieldChanges.length} campo(s) auditado(s): ${res.fieldChanges
                    .slice(0, 3)
                    .map((c) => c.label)
                    .join(', ')}${res.fieldChanges.length > 3 ? '…' : ''}`
                : res.changedFields.join(', ') || 'confirmada';
            setRouteFeedback({
              type: 'ok',
              msg: res.newScoring
                ? `${res.application.applicationNumber} actualizada (${diffSummary}) y reevaluada por Motor V2: Score ${
                    res.previousScore !== null ? `${res.previousScore} → ` : ''
                  }${res.newScoring.totalScore}/100 (${SCORING_STATUS_LABELS[res.newScoring.status]} · Rec.: ${formatMoney(
                    res.newScoring.recommendedAmount,
                    res.application.currency
                  )}).`
                : `${res.application.applicationNumber} actualizada correctamente con registro de auditoría (${diffSummary}).`,
            });
          }}
        />
      )}

      {selectedServiceReq && (
        <div
          className="fixed inset-0 z-50 bg-[#030816]/65 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => setSelectedServiceReq(null)}
        >
          <div
            className="axy-panel-in axy-surface relative w-full max-w-xl rounded-2xl border border-[var(--axy-border-strong)] overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="axy-infinity-line" />
            <div className="px-5 py-4 border-b border-[var(--axy-border)] flex items-center justify-between">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Atender Gestión · {selectedServiceReq.ticketNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedServiceReq.clientName} ({selectedServiceReq.clientEmail})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedServiceReq(null)}
                className="axy-btn-secondary p-1.5 text-slate-500 cursor-pointer"
                aria-label="Cerrar gestión"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveServiceReply} className="p-5 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-white/10 space-y-1">
                <p className="font-semibold text-slate-900 dark:text-white">
                  {getServiceRequestCatalogItem(selectedServiceReq.requestType).label} · {selectedServiceReq.subject}
                </p>
                <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
                  {selectedServiceReq.details}
                </p>
                {(selectedServiceReq.documentNumber || selectedServiceReq.contactPhone || selectedServiceReq.loanNumber) && (
                  <p className="text-[11px] font-mono text-slate-500 pt-1">
                    {selectedServiceReq.loanNumber ? `Préstamo: ${selectedServiceReq.loanNumber} · ` : ''}
                    {selectedServiceReq.documentNumber ? `Doc: ${selectedServiceReq.documentNumber} · ` : ''}
                    {selectedServiceReq.contactPhone ? `Tel: ${selectedServiceReq.contactPhone}` : ''}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nuevo estado *
                  </label>
                  <select
                    value={serviceReplyStatus}
                    onChange={(e) => setServiceReplyStatus(e.target.value as ClientServiceRequestStatus)}
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                  >
                    <option value="EN_PROCESO">En proceso</option>
                    <option value="COMPLETADA">Completada</option>
                    <option value="RECHAZADA">Rechazada</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                    <Link2 className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
                    <span>Vincular expediente de cliente (opcional)</span>
                  </label>
                  <select
                    value={serviceLinkCustomerId}
                    onChange={(e) => setServiceLinkCustomerId(e.target.value)}
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                  >
                    <option value="">Sin cambios en vinculación</option>
                    {customers.slice(0, 250).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName} · {c.documentNumber}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Respuesta oficial al cliente *
                </label>
                <textarea
                  rows={4}
                  required
                  value={serviceReplyText}
                  onChange={(e) => setServiceReplyText(e.target.value)}
                  placeholder="Escribe las instrucciones, confirmación de carta de saldo, acuerdo aprobado o confirmación de vinculación..."
                  className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedServiceReq(null)}
                  className="axy-btn-secondary px-4 py-2 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingServiceReply}
                  className="px-4 py-2 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {savingServiceReply ? 'Guardando...' : 'Enviar Respuesta al Cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedPublicApp && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="axy-surface w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl border border-slate-200 dark:border-[#00B8FF]/20 overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-mono text-[#0052CC] dark:text-[#00D1FF]">
                  {selectedPublicApp.trackingNumber} · Portal {selectedPublicApp.portalCode} ·{' '}
                  {selectedPublicApp.applicantType === 'BUSINESS' ? 'Persona Jurídica / Empresa' : 'Persona Física'}
                </p>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white truncate">
                  {selectedPublicApp.applicantFullName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPublicApp(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              {/* 1. Solicitante y Residencia */}
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-1">
                  1. Datos del Solicitante y Residencia
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-slate-500 block">Documento</span>
                    <span className="font-mono font-medium text-slate-900 dark:text-white">
                      {selectedPublicApp.documentType}: {selectedPublicApp.documentNumber}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Teléfono Principal</span>
                    <span className="font-mono font-medium text-slate-900 dark:text-white">
                      {selectedPublicApp.phone}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Correo Electrónico</span>
                    <span className="font-mono text-slate-900 dark:text-white">
                      {selectedPublicApp.email || 'No indicado'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Fecha Nacimiento / Estado Civil</span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {selectedPublicApp.customerDetails?.birthDate || '—'} ·{' '}
                      {selectedPublicApp.customerDetails?.maritalStatus || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Vivienda y Residencia</span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {selectedPublicApp.customerDetails?.housingType || '—'} (
                      {selectedPublicApp.customerDetails?.residenceMonths ?? 0} meses) · Pago:{' '}
                      <span className="font-mono tabular-nums">
                        {formatMoney(
                          selectedPublicApp.customerDetails?.housingPayment ?? 0,
                          selectedPublicApp.currency
                        )}
                      </span>
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Contacto Alternativo</span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {selectedPublicApp.customerDetails?.altContactName || '—'}{' '}
                      {selectedPublicApp.customerDetails?.altContactPhone
                        ? `(${selectedPublicApp.customerDetails.altContactPhone})`
                        : ''}
                    </span>
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <span className="text-slate-500 block">Dirección / Municipio / Provincia</span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {[
                        selectedPublicApp.address,
                        selectedPublicApp.customerDetails?.municipality,
                        selectedPublicApp.province,
                      ]
                        .filter(Boolean)
                        .join(', ') || 'No indicada'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Datos Societarios si aplica */}
              {selectedPublicApp.businessDetails && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-1">
                    Datos Societarios de la Empresa
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <span className="text-slate-500 block">RNC</span>
                      <span className="font-mono font-medium text-slate-900 dark:text-white">
                        {selectedPublicApp.businessDetails.rnc}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Razón Social</span>
                      <span className="font-medium text-slate-900 dark:text-white">
                        {selectedPublicApp.businessDetails.legalName}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Representante Autorizado</span>
                      <span className="text-slate-800 dark:text-slate-200">
                        {selectedPublicApp.businessDetails.authorizedRepName}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. Laboral y Finanzas */}
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-1">
                  2. Información Laboral y Financiera
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <span className="text-slate-500 block">Actividad / Empresa</span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {selectedPublicApp.financialData?.activityType || '—'} ·{' '}
                      {selectedPublicApp.financialData?.employerOrBusinessName ||
                        selectedPublicApp.employerOrActivity ||
                        '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Ingreso / Flujo Mensual</span>
                    <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                      {formatMoney(selectedPublicApp.monthlyIncome, selectedPublicApp.currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Gastos Esenciales</span>
                    <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {formatMoney(selectedPublicApp.monthlyExpenses, selectedPublicApp.currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Cuotas de Deudas (D)</span>
                    <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {formatMoney(
                        selectedPublicApp.financialData?.currentDebtPayments ?? 0,
                        selectedPublicApp.currency
                      )}{' '}
                      ({selectedPublicApp.financialData?.debtDeclarationStatus || 'NO_DEBTS_EXPLICIT'})
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Condiciones Solicitadas */}
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-1">
                  3. Condiciones Solicitadas
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <span className="text-slate-500 block">Producto</span>
                    <span className="font-medium text-slate-900 dark:text-white">
                      {PRODUCT_LABELS[selectedPublicApp.productCode] || selectedPublicApp.productCode}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Monto Solicitado</span>
                    <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                      {formatMoney(selectedPublicApp.requestedAmount, selectedPublicApp.currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Plazo y Frecuencia</span>
                    <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {selectedPublicApp.requestedTermMonths} meses · {selectedPublicApp.paymentFrequency}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Amortización</span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {selectedPublicApp.amortizationMethod || 'SALDO_INSOLUTO'}
                    </span>
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <span className="text-slate-500 block">Destino y Garantía Propuesta</span>
                    <span className="text-slate-800 dark:text-slate-200">
                      {selectedPublicApp.loanPurpose}
                      {selectedPublicApp.loanPurposeDescription
                        ? ` — ${selectedPublicApp.loanPurposeDescription}`
                        : ''}
                      {selectedPublicApp.proposedCollateral
                        ? ` · Garantía: ${selectedPublicApp.proposedCollateral}`
                        : ''}
                    </span>
                  </div>
                </div>
              </div>

              {/* 4. Referencias, Documentos y Biometría */}
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-1">
                  4. Referencias, Documentos y Consentimiento ({selectedPublicApp.consentVersion || 'v1.0-Ley172-13'})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="text-slate-500 block mb-1">
                      Referencias ({selectedPublicApp.references?.length ?? 0})
                    </span>
                    {selectedPublicApp.references && selectedPublicApp.references.length > 0 ? (
                      <ul className="space-y-1 text-slate-800 dark:text-slate-200">
                        {selectedPublicApp.references.map((r, i) => (
                          <li key={i}>
                            {r.name} ({r.relationship || 'Referencia'}) ·{' '}
                            <span className="font-mono">{r.phone}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-slate-400">Sin referencias declaradas</span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-1">
                      Adjuntos ({selectedPublicApp.attachedDocuments?.length ?? 0})
                    </span>
                    {selectedPublicApp.attachedDocuments &&
                    selectedPublicApp.attachedDocuments.length > 0 ? (
                      <ul className="space-y-1 text-slate-800 dark:text-slate-200 font-mono text-[11px]">
                        {selectedPublicApp.attachedDocuments.map((d, i) => (
                          <li key={i}>
                            [{d.category}] {d.fileName} ({Math.round(d.sizeBytes / 1024)} KB)
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-slate-400">Sin archivos adjuntos</span>
                    )}
                    {selectedPublicApp.biometricSummary && (
                      <p className="mt-1.5 text-[11px] font-mono text-[#0052CC] dark:text-[#00D1FF]">
                        Biometría: {selectedPublicApp.biometricSummary.verdict} (
                        {selectedPublicApp.biometricSummary.similarityScore}% · Liveness{' '}
                        {selectedPublicApp.biometricSummary.livenessAssessment})
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-2.5">
              <span className="text-[11px] text-slate-500 font-mono">
                Consentimiento Ley 172-13 aceptado: {selectedPublicApp.consentAcceptedAt}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedPublicApp(null)}
                  className="axy-btn-secondary px-3.5 py-2 text-xs cursor-pointer"
                >
                  Cerrar
                </button>
                {selectedPublicApp.status === 'RECIBIDA_PUBLICA' && !rbac.isReadOnlyAuditor && (
                  <>
                    <button
                      type="button"
                      disabled={discardingPubAppId === selectedPublicApp.id}
                      onClick={async () => {
                        const target = selectedPublicApp;
                        setSelectedPublicApp(null);
                        await handleDiscardPublicApp(target);
                      }}
                      className="px-3.5 py-2 rounded-xl border border-rose-500/35 text-rose-600 dark:text-rose-300 text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      Descartar
                    </button>
                    <button
                      type="button"
                      disabled={convertingPubAppId === selectedPublicApp.id}
                      onClick={async () => {
                        const target = selectedPublicApp;
                        setSelectedPublicApp(null);
                        await handleConvertPublicApp(target);
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0066FF] hover:bg-[#0052CC] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <Cpu className="w-3.5 h-3.5" />
                      <span>Ingresar y Evaluar V2</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <ApplicationDetailDrawer
        applicationId={selectedApplicationId}
        initialTab={drawerInitialTab}
        onClose={() => {
          setSelectedApplicationId(null);
          setDrawerInitialTab('overview');
        }}
      />
    </div>
  );
}
