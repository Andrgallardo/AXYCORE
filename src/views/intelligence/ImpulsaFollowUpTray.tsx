import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightCircle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  History,
  LayoutGrid,
  List,
  Lock,
  Phone,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  AmortizationMethod,
  ApplicationRecord,
  AuditLogRecord,
  CollectionAccountRecord,
  CreditPolicyRecord,
  CustomerRecord,
  LoanRecord,
  NavSectionId,
  PaymentFrequency,
  ProductCode,
  RiskAlertRecord,
  UserProfile,
} from '../../types/axycore';
import {
  IMPULSA_ALL_STATUSES,
  IMPULSA_CATEGORY_LABELS,
  IMPULSA_PRIORITY_LABELS,
  IMPULSA_STATUS_LABELS,
  type ImpulsaContactChannel,
  type ImpulsaOpportunityRecord,
  type ImpulsaOpportunityStatus,
  type ImpulsaPriority,
} from '../../types/impulsa';
import { hasRolePermission } from '../../engine/rbac';
import {
  getLifecycleMacroStage,
  type LifecycleMacroStage,
} from '../../engine/impulsa/impulsaEngine';
import { resolveExpectedStatusFromAxyCore } from '../../services/impulsaStore';

export { getLifecycleMacroStage, type LifecycleMacroStage };

interface EnrichedOpportunity {
  opp: ImpulsaOpportunityRecord;
  macroStage: LifecycleMacroStage;
  liveCustomer: CustomerRecord | null;
  liveSourceLoan: LoanRecord | null;
  liveCollectionAccount: CollectionAccountRecord | null;
  liveLinkedApplication: ApplicationRecord | null;
  liveLinkedLoan: LoanRecord | null;
  liveOpenAlerts: RiskAlertRecord[];
  syncState: ReturnType<typeof resolveExpectedStatusFromAxyCore>;
  slaHoursElapsed: number;
  auditTrail: AuditLogRecord[];
}

interface ImpulsaFollowUpTrayProps {
  opportunities: ImpulsaOpportunityRecord[];
  customers: CustomerRecord[];
  loans: LoanRecord[];
  applications: ApplicationRecord[];
  collectionAccounts: CollectionAccountRecord[];
  riskAlerts: RiskAlertRecord[];
  auditLogs: AuditLogRecord[];
  usersList: UserProfile[];
  currentUser: UserProfile;
  policy: CreditPolicyRecord;
  unmanagedAlertHours: number;
  selectedOpportunityId: string | null;
  onSelectOpportunity: (id: string | null) => void;
  onAssign: (params: {
    opportunity: ImpulsaOpportunityRecord;
    targetOfficer: { uid: string; displayName: string };
    reason: string;
  }) => Promise<void>;
  onLogFollowUp: (params: {
    opportunity: ImpulsaOpportunityRecord;
    newStatus: ImpulsaOpportunityStatus;
    channel: ImpulsaContactChannel;
    outcome: string;
    comment: string;
    nextFollowUpDate?: string | null;
  }) => Promise<void>;
  onConvertToApplication: (params: {
    opportunity: ImpulsaOpportunityRecord;
    productCode: ProductCode;
    requestedAmount: number;
    requestedTermMonths: number;
    paymentFrequency: PaymentFrequency;
    amortizationMethod: AmortizationMethod;
    loanPurposeNote?: string;
    submitMode: 'SUBMIT' | 'DRAFT';
  }) => Promise<{
    application: { id: string; applicationNumber: string; status: string };
    scoring?: { totalScore: number };
  }>;
  onSyncWithAxyCore: (targets?: ImpulsaOpportunityRecord[]) => Promise<{
    syncedCount: number;
    syncedCodes: string[];
  }>;
  onNavigateSection: (section: NavSectionId) => void;
}

const MACRO_STAGE_META: Record<
  Exclude<LifecycleMacroStage, 'CERRADA'>,
  {
    step: number;
    title: string;
    subtitle: string;
    dotClass: string;
    headerAccent: string;
    statuses: ImpulsaOpportunityStatus[];
  }
> = {
  DETECTADA: {
    step: 1,
    title: 'Detectada',
    subtitle: 'Identificada en cartera · Pendiente de asignar',
    dotClass: 'bg-blue-600',
    headerAccent: 'border-t-blue-600',
    statuses: ['DETECTADA', 'PENDIENTE_ASIGNACION'],
  },
  ASIGNADA: {
    step: 2,
    title: 'Asignada',
    subtitle: 'Con oficial exclusivo · Pendiente de contacto',
    dotClass: 'bg-amber-500',
    headerAccent: 'border-t-amber-500',
    statuses: ['ASIGNADA', 'PENDIENTE_CONTACTO', 'REPROGRAMADA'],
  },
  CONTACTADA: {
    step: 3,
    title: 'Contactada',
    subtitle: 'En conversación, interés o documentación',
    dotClass: 'bg-indigo-600',
    headerAccent: 'border-t-indigo-600',
    statuses: ['CONTACTADA', 'CLIENTE_INTERESADO', 'PENDIENTE_DOCUMENTACION'],
  },
  CONVERTIDA: {
    step: 4,
    title: 'Convertida en Solicitud',
    subtitle: 'Vinculada a Motor V2, Evaluación y Desembolso',
    dotClass: 'bg-emerald-600',
    headerAccent: 'border-t-emerald-600',
    statuses: ['CONVERTIDA_SOLICITUD', 'EN_EVALUACION', 'APROBADA', 'DESEMBOLSADA'],
  },
};

const PRIORITY_TEXT: Record<ImpulsaPriority, string> = {
  CRITICA: 'text-red-700 dark:text-red-400',
  ALTA: 'text-amber-700 dark:text-amber-400',
  MEDIA: 'text-blue-700 dark:text-blue-400',
  BAJA: 'text-slate-500 dark:text-slate-400',
};

function fmtMoney(amount: number, currency: string): string {
  const prefix = currency === 'USD' ? 'US$' : 'RD$';
  return `${prefix}${Math.round(amount || 0).toLocaleString('en-US')}`;
}

function fmtShortDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' });
}

export const ImpulsaFollowUpTray: React.FC<ImpulsaFollowUpTrayProps> = ({
  opportunities,
  customers,
  loans,
  applications,
  collectionAccounts,
  riskAlerts,
  auditLogs,
  usersList,
  currentUser,
  policy,
  unmanagedAlertHours,
  selectedOpportunityId,
  onSelectOpportunity,
  onAssign,
  onLogFollowUp,
  onConvertToApplication,
  onSyncWithAxyCore,
  onNavigateSection,
}) => {
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [stageFilter, setStageFilter] = useState<LifecycleMacroStage | 'ALL'>('ALL');
  const [subStatusFilter, setSubStatusFilter] = useState<ImpulsaOpportunityStatus | 'ALL'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [officerFilter, setOfficerFilter] = useState('ALL');
  const [onlyMine, setOnlyMine] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  // Selected drawer action panel state
  const [activeActionTab, setActiveActionTab] = useState<'assign' | 'contact' | 'convert'>('contact');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Assignment form
  const [assignOfficerId, setAssignOfficerId] = useState('');
  const [assignReason, setAssignReason] = useState('');

  // Contact / status form
  const [fuStatus, setFuStatus] = useState<ImpulsaOpportunityStatus>('CONTACTADA');
  const [fuChannel, setFuChannel] = useState<ImpulsaContactChannel>('LLAMADA');
  const [fuOutcome, setFuOutcome] = useState('');
  const [fuComment, setFuComment] = useState('');
  const [fuNextDate, setFuNextDate] = useState('');

  // Convert to Application form
  const [convProduct, setConvProduct] = useState<ProductCode>('PERSONAL_DOP');
  const [convAmount, setConvAmount] = useState<number>(0);
  const [convTerm, setConvTerm] = useState<number>(12);
  const [convFreq, setConvFreq] = useState<PaymentFrequency>('MENSUAL');
  const [convAmort, setConvAmort] = useState<AmortizationMethod>('SALDO_INSOLUTO');
  const [convPurpose, setConvPurpose] = useState('');

  const canManage = hasRolePermission(currentUser.role, 'MANAGE_IMPULSA');
  const canAssign = hasRolePermission(currentUser.role, 'ASSIGN_IMPULSA');
  const canConvert =
    hasRolePermission(currentUser.role, 'CONVERT_IMPULSA') ||
    hasRolePermission(currentUser.role, 'ORIGINATE_APPLICATION');

  const assignableOfficers = useMemo(
    () =>
      usersList.filter(
        (u) =>
          u.status === 'ACTIVE' && u.role !== 'EXTERNAL_CLIENT' && u.role !== 'AUDITOR'
      ),
    [usersList]
  );

  // Live cross-join with real AxyCore entities
  const enrichedList = useMemo<EnrichedOpportunity[]>(() => {
    const customersById = new Map(customers.map((c) => [c.id, c]));
    const loansById = new Map(loans.map((l) => [l.id, l]));
    const loansByAppId = new Map<string, LoanRecord>();
    for (const l of loans) {
      if (l.applicationId) loansByAppId.set(l.applicationId, l);
    }
    const appsById = new Map(applications.map((a) => [a.id, a]));
    const collByLoanId = new Map(collectionAccounts.map((c) => [c.loanId, c]));
    const alertsByCust = new Map<string, RiskAlertRecord[]>();
    for (const al of riskAlerts) {
      if (al.status === 'ACTIVA' || al.status === 'EN_REVISION') {
        const arr = alertsByCust.get(al.customerId) || [];
        arr.push(al);
        alertsByCust.set(al.customerId, arr);
      }
    }
    const auditsByOppId = new Map<string, AuditLogRecord[]>();
    for (const log of auditLogs) {
      if (log.entityType === 'impulsa_opportunities') {
        const arr = auditsByOppId.get(log.entityId) || [];
        arr.push(log);
        auditsByOppId.set(log.entityId, arr);
      }
    }

    const nowMs = Date.now();
    return opportunities
      .map((opp) => {
        const liveCustomer = customersById.get(opp.customerId) || null;
        const liveSourceLoan = opp.sourceLoanId ? loansById.get(opp.sourceLoanId) || null : null;
        const liveCollectionAccount = opp.sourceLoanId
          ? collByLoanId.get(opp.sourceLoanId) || null
          : null;
        const liveLinkedApplication = opp.linkedApplicationId
          ? appsById.get(opp.linkedApplicationId) || null
          : null;
        const liveLinkedLoan = opp.linkedApplicationId
          ? loansByAppId.get(opp.linkedApplicationId) ||
            (opp.linkedLoanId ? loansById.get(opp.linkedLoanId) || null : null)
          : null;
        const liveOpenAlerts = alertsByCust.get(opp.customerId) || [];
        const syncState = resolveExpectedStatusFromAxyCore({
          opportunity: opp,
          application: liveLinkedApplication,
          loan: liveLinkedLoan,
        });
        const detectedMs = new Date(opp.detectedAtIso).getTime();
        const slaHoursElapsed = Number.isFinite(detectedMs)
          ? Math.max(0, Math.floor((nowMs - detectedMs) / 3_600_000))
          : 0;

        return {
          opp,
          macroStage: getLifecycleMacroStage(opp.status),
          liveCustomer,
          liveSourceLoan,
          liveCollectionAccount,
          liveLinkedApplication,
          liveLinkedLoan,
          liveOpenAlerts,
          syncState,
          slaHoursElapsed,
          auditTrail: auditsByOppId.get(opp.id) || [],
        };
      })
      .sort((a, b) => b.opp.priorityScore - a.opp.priorityScore);
  }, [opportunities, customers, loans, applications, collectionAccounts, riskAlerts, auditLogs]);

  const outOfSyncItems = useMemo(
    () => enrichedList.filter((item) => item.syncState.needsSync),
    [enrichedList]
  );

  const stageSummaries = useMemo(() => {
    const base: Record<LifecycleMacroStage, { count: number; potentialAmount: number }> = {
      DETECTADA: { count: 0, potentialAmount: 0 },
      ASIGNADA: { count: 0, potentialAmount: 0 },
      CONTACTADA: { count: 0, potentialAmount: 0 },
      CONVERTIDA: { count: 0, potentialAmount: 0 },
      CERRADA: { count: 0, potentialAmount: 0 },
    };
    for (const item of enrichedList) {
      base[item.macroStage].count += 1;
      base[item.macroStage].potentialAmount += item.opp.suggestedAmount;
    }
    return base;
  }, [enrichedList]);

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return enrichedList.filter(({ opp, liveCustomer, liveLinkedApplication }) => {
      if (!showClosed && stageFilter !== 'CERRADA' && getLifecycleMacroStage(opp.status) === 'CERRADA') {
        return false;
      }
      if (stageFilter !== 'ALL' && getLifecycleMacroStage(opp.status) !== stageFilter) return false;
      if (subStatusFilter !== 'ALL' && opp.status !== subStatusFilter) return false;
      if (onlyMine && opp.assignedOfficerId !== currentUser.uid) return false;
      if (officerFilter === 'UNASSIGNED' && opp.assignedOfficerId) return false;
      if (
        officerFilter !== 'ALL' &&
        officerFilter !== 'UNASSIGNED' &&
        opp.assignedOfficerId !== officerFilter
      ) {
        return false;
      }
      if (q) {
        const hay = `${opp.customerName} ${opp.opportunityCode} ${liveCustomer?.documentNumber || opp.customerDocument || ''} ${opp.sourceLoanNumber || ''} ${liveLinkedApplication?.applicationNumber || opp.linkedApplicationNumber || ''} ${opp.assignedOfficerName || ''} ${opp.branchOrProvince}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    enrichedList,
    showClosed,
    stageFilter,
    subStatusFilter,
    onlyMine,
    officerFilter,
    searchTerm,
    currentUser.uid,
  ]);

  const selectedItem = useMemo(
    () => enrichedList.find((e) => e.opp.id === selectedOpportunityId) || null,
    [enrichedList, selectedOpportunityId]
  );

  const openItem = (
    item: EnrichedOpportunity,
    preferredAction?: 'assign' | 'contact' | 'convert'
  ) => {
    const { opp } = item;
    onSelectOpportunity(opp.id);
    setFeedback(null);
    setAssignOfficerId(opp.assignedOfficerId || currentUser.uid);
    setAssignReason('');

    const defaultNextStatus: ImpulsaOpportunityStatus =
      item.macroStage === 'DETECTADA' || item.macroStage === 'ASIGNADA'
        ? 'CONTACTADA'
        : opp.status === 'CONTACTADA'
        ? 'CLIENTE_INTERESADO'
        : opp.status;
    setFuStatus(defaultNextStatus);
    setFuChannel('LLAMADA');
    setFuOutcome('');
    setFuComment('');
    setFuNextDate(opp.nextFollowUpDate || '');

    setConvProduct(opp.recommendedProductCode);
    setConvAmount(opp.suggestedAmount);
    setConvTerm(opp.suggestedTermMonths);
    setConvFreq(opp.suggestedFrequency);
    setConvAmort('SALDO_INSOLUTO');
    setConvPurpose(
      `${IMPULSA_CATEGORY_LABELS[opp.category]} · ${opp.opportunityCode} (${opp.summaryReason})`
    );

    if (preferredAction) {
      setActiveActionTab(preferredAction);
    } else if (item.macroStage === 'DETECTADA') {
      setActiveActionTab('assign');
    } else if (item.macroStage === 'CONTACTADA' && !opp.linkedApplicationId) {
      setActiveActionTab('convert');
    } else {
      setActiveActionTab('contact');
    }
  };

  const handleGlobalSync = async (targets?: ImpulsaOpportunityRecord[]) => {
    setBusyAction('sync');
    setFeedback(null);
    try {
      const res = await onSyncWithAxyCore(targets);
      setFeedback({
        type: 'ok',
        text:
          res.syncedCount > 0
            ? `Sincronización completada: ${res.syncedCount} oportunidad(es) actualizada(s) desde solicitudes/préstamos reales de AxyCore.`
            : 'Todas las oportunidades ya están sincronizadas con los datos actuales de AxyCore.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error sincronizando estados con AxyCore.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    const target = assignableOfficers.find((u) => u.uid === assignOfficerId);
    if (!target) {
      setFeedback({ type: 'err', text: 'Selecciona un oficial válido.' });
      return;
    }
    setBusyAction('assign');
    setFeedback(null);
    try {
      await onAssign({
        opportunity: selectedItem.opp,
        targetOfficer: { uid: target.uid, displayName: target.displayName || target.email },
        reason:
          assignReason.trim() ||
          `Asignación desde Bandeja de Seguimiento a ${target.displayName || target.email}`,
      });
      setAssignReason('');
      setActiveActionTab('contact');
      setFeedback({
        type: 'ok',
        text: `Etapa actualizada a Asignada (${target.displayName || target.email}). Registro guardado en bitácora.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo asignar la oportunidad.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    if (!fuComment.trim()) {
      setFeedback({
        type: 'err',
        text: 'Ingresa una nota de seguimiento obligatoria para mantener la trazabilidad.',
      });
      return;
    }
    setBusyAction('contact');
    setFeedback(null);
    try {
      await onLogFollowUp({
        opportunity: selectedItem.opp,
        newStatus: fuStatus,
        channel: fuChannel,
        outcome: fuOutcome.trim() || IMPULSA_STATUS_LABELS[fuStatus],
        comment: fuComment.trim(),
        nextFollowUpDate: fuNextDate || null,
      });
      setFuOutcome('');
      setFuComment('');
      setFeedback({
        type: 'ok',
        text: `Gestión registrada en trazabilidad · Estado actual: ${IMPULSA_STATUS_LABELS[fuStatus]}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo registrar el contacto.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleConvertSubmit = async (submitMode: 'SUBMIT' | 'DRAFT') => {
    if (!selectedItem) return;
    setBusyAction('convert');
    setFeedback(null);
    try {
      const res = await onConvertToApplication({
        opportunity: selectedItem.opp,
        productCode: convProduct,
        requestedAmount: Number(convAmount),
        requestedTermMonths: Number(convTerm),
        paymentFrequency: convFreq,
        amortizationMethod: convAmort,
        loanPurposeNote: convPurpose,
        submitMode,
      });
      setFeedback({
        type: 'ok',
        text: `Convertida en solicitud real ${res.application.applicationNumber} (${res.application.status})${
          res.scoring ? ` · Motor V2 Score: ${res.scoring.totalScore}/100` : ''
        }. Vinculada al cliente existente sin duplicación.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error convirtiendo oportunidad en solicitud.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const isLockedByOther = Boolean(
    selectedItem?.opp.assignedOfficerId &&
      selectedItem.opp.assignedOfficerId !== currentUser.uid &&
      !canAssign
  );

  return (
    <div className="space-y-4">
      {/* Live AxyCore Reconciliation Alert Banner */}
      {outOfSyncItems.length > 0 && canManage && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs">
            <RefreshCw className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-emerald-900 dark:text-emerald-200">
                {outOfSyncItems.length} oportunidad(es) con avance detectado en AxyCore
              </div>
              <div className="text-emerald-800/80 dark:text-emerald-300/80">
                Sus solicitudes o préstamos vinculados avanzaron en Evaluación, Comité o Desembolso. Sincroniza para consolidar los estados y registrar la trazabilidad oficial.
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={busyAction === 'sync'}
            onClick={() => void handleGlobalSync(outOfSyncItems.map((i) => i.opp))}
            className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'sync' ? 'animate-spin' : ''}`} />
            Sincronizar con AxyCore ({outOfSyncItems.length})
          </button>
        </div>
      )}

      {/* 4-Stage Lifecycle Flow Bar (Detectada -> Asignada -> Contactada -> Convertida en Solicitud) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Bandeja de Seguimiento del Ciclo de Vida Comercial
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Flujo trazable conectado en vivo a Clientes, Préstamos, Centinela, Solicitudes y Motor V2.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowClosed((v) => !v)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                showClosed || stageFilter === 'CERRADA'
                  ? 'border-slate-800 dark:border-slate-200 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Descartadas / No interesadas ({stageSummaries.CERRADA.count})
            </button>
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setViewMode('board')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 ${
                  viewMode === 'board'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Flujo
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 ${
                  viewMode === 'list'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                Lista
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {(['DETECTADA', 'ASIGNADA', 'CONTACTADA', 'CONVERTIDA'] as const).map((stageKey, idx) => {
            const meta = MACRO_STAGE_META[stageKey];
            const summary = stageSummaries[stageKey];
            const active = stageFilter === stageKey;
            return (
              <button
                key={stageKey}
                type="button"
                onClick={() => {
                  setStageFilter(active ? 'ALL' : stageKey);
                  setSubStatusFilter('ALL');
                }}
                className={`text-left rounded-xl border border-t-4 ${meta.headerAccent} p-3.5 transition-all relative ${
                  active
                    ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 ring-1 ring-blue-500/30'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${meta.dotClass}`} />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Etapa {meta.step}
                    </span>
                  </div>
                  {idx < 3 && (
                    <ArrowRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-700 hidden lg:block" />
                  )}
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                  {meta.title}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                  {meta.subtitle}
                </div>
                <div className="mt-2.5 flex items-baseline justify-between">
                  <span className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">
                    {summary.count}
                  </span>
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                    RD${Math.round(summary.potentialAmount).toLocaleString('en-US')}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Search & Fine Filters */}
        <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filtrar por cliente, cédula, código IMP, préstamo origen o solicitud..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>

          <select
            value={subStatusFilter}
            onChange={(e) =>
              setSubStatusFilter(e.target.value as ImpulsaOpportunityStatus | 'ALL')
            }
            className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-800 dark:text-slate-200"
          >
            <option value="ALL">Sub-estado (14 estados)</option>
            {IMPULSA_ALL_STATUSES.map((st) => (
              <option key={st} value={st}>
                {IMPULSA_STATUS_LABELS[st]}
              </option>
            ))}
          </select>

          <select
            value={officerFilter}
            onChange={(e) => setOfficerFilter(e.target.value)}
            className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-slate-800 dark:text-slate-200"
          >
            <option value="ALL">Todos los oficiales</option>
            <option value="UNASSIGNED">Sin asignar</option>
            {assignableOfficers.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.displayName || u.email}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => setOnlyMine(e.target.checked)}
              className="rounded border-slate-300"
            />
            Solo mis casos
          </label>
        </div>
      </div>

      {/* Main Content: Board or List + Selected Lifecycle & Traceability Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className={selectedItem ? 'xl:col-span-7' : 'xl:col-span-12'}>
          {viewMode === 'board' ? (
            <div
              className={`grid grid-cols-1 ${
                selectedItem ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-4'
              } gap-3.5`}
            >
              {(['DETECTADA', 'ASIGNADA', 'CONTACTADA', 'CONVERTIDA'] as const)
                .filter((st) => stageFilter === 'ALL' || stageFilter === st)
                .map((stageKey) => {
                  const meta = MACRO_STAGE_META[stageKey];
                  const colItems = filteredItems.filter((i) => i.macroStage === stageKey);
                  return (
                    <div
                      key={stageKey}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-col max-h-[760px]"
                    >
                      <div className="px-3.5 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-t-xl flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${meta.dotClass}`} />
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            {meta.step}. {meta.title}
                          </span>
                        </div>
                        <span className="text-xs font-bold text-slate-500 tabular-nums">
                          {colItems.length}
                        </span>
                      </div>

                      <div className="p-2.5 space-y-2.5 overflow-y-auto flex-1">
                        {colItems.length === 0 ? (
                          <div className="py-8 text-center text-[11px] text-slate-400">
                            Sin oportunidades en esta etapa
                          </div>
                        ) : (
                          colItems.map((item) => {
                            const {
                              opp,
                              liveSourceLoan,
                              liveCollectionAccount,
                              liveLinkedApplication,
                              liveLinkedLoan,
                              liveOpenAlerts,
                              syncState,
                              slaHoursElapsed,
                            } = item;
                            const isSelected = selectedItem?.opp.id === opp.id;
                            const liveBalance =
                              liveSourceLoan?.currentPrincipalBalance ?? opp.currentLoanBalance;
                            const liveDpd = liveCollectionAccount?.dpd ?? opp.currentDpd;
                            const slaBreached =
                              !opp.lastContactAtIso &&
                              (stageKey === 'DETECTADA' || stageKey === 'ASIGNADA') &&
                              slaHoursElapsed >= unmanagedAlertHours;

                            return (
                              <div
                                key={opp.id}
                                onClick={() => openItem(item)}
                                className={`rounded-xl border p-3 bg-white dark:bg-slate-900 cursor-pointer transition-all space-y-2 ${
                                  isSelected
                                    ? 'border-blue-600 ring-2 ring-blue-500/20'
                                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                      {opp.customerName}
                                    </div>
                                    <div className="text-[11px] text-slate-500 tabular-nums flex items-center gap-1.5">
                                      <span>{opp.opportunityCode}</span>
                                      <span>·</span>
                                      <span className={`font-semibold ${PRIORITY_TEXT[opp.priority]}`}>
                                        {IMPULSA_PRIORITY_LABELS[opp.priority]}
                                      </span>
                                    </div>
                                  </div>
                                  {liveOpenAlerts.length > 0 && (
                                    <ShieldAlert
                                      className="w-4 h-4 text-amber-500 shrink-0"
                                      aria-label="Alerta Centinela activa"
                                    />
                                  )}
                                </div>

                                <div className="text-[11px] text-slate-700 dark:text-slate-300 font-medium">
                                  {IMPULSA_CATEGORY_LABELS[opp.category]} ·{' '}
                                  <span className="font-bold tabular-nums">
                                    {fmtMoney(opp.suggestedAmount, opp.currency)}
                                  </span>
                                </div>

                                {/* Live AxyCore Linked Facts */}
                                <div className="rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-100 dark:border-slate-800 px-2.5 py-1.5 text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5 tabular-nums">
                                  {opp.sourceLoanNumber && (
                                    <div className="flex justify-between gap-1">
                                      <span>Préstamo {opp.sourceLoanNumber}</span>
                                      <span>
                                        Saldo {fmtMoney(liveBalance, opp.currency)} · {liveDpd}d
                                      </span>
                                    </div>
                                  )}
                                  {opp.assignedOfficerName && (
                                    <div className="flex justify-between gap-1">
                                      <span>Oficial</span>
                                      <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                                        {opp.assignedOfficerName}
                                      </span>
                                    </div>
                                  )}
                                  {(liveLinkedApplication || opp.linkedApplicationNumber) && (
                                    <div className="flex justify-between gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                                      <span>
                                        {liveLinkedApplication?.applicationNumber ||
                                          opp.linkedApplicationNumber}
                                      </span>
                                      <span>
                                        {liveLinkedLoan
                                          ? `Préstamo ${liveLinkedLoan.loanNumber}`
                                          : liveLinkedApplication?.status ||
                                            opp.linkedApplicationStatus}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {/* Status / SLA / Sync Footer */}
                                <div className="flex items-center justify-between gap-2 pt-1 text-[11px]">
                                  <span className="text-slate-500 truncate">
                                    {IMPULSA_STATUS_LABELS[opp.status]}
                                  </span>
                                  <span className="text-slate-400 tabular-nums shrink-0">
                                    {opp.followUpHistory.length} reg.
                                  </span>
                                </div>

                                {slaBreached && (
                                  <div className="text-[11px] text-amber-700 dark:text-amber-400 font-medium inline-flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    Sin contacto hace {slaHoursElapsed}h
                                  </div>
                                )}

                                {syncState.needsSync && (
                                  <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1">
                                    <RefreshCw className="w-3 h-3" />
                                    Nuevo estado en AxyCore: {IMPULSA_STATUS_LABELS[syncState.expectedStatus]}
                                  </div>
                                )}

                                {/* Contextual Next-Step Lifecycle Action */}
                                <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                                  {stageKey === 'DETECTADA' && (canAssign || canManage) && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openItem(item, 'assign');
                                      }}
                                      className="w-full py-1.5 px-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-950 text-blue-700 dark:text-blue-300 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                                    >
                                      <UserPlus className="w-3.5 h-3.5" />
                                      Asignar Oficial
                                    </button>
                                  )}
                                  {stageKey === 'ASIGNADA' && canManage && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openItem(item, 'contact');
                                      }}
                                      className="w-full py-1.5 px-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950 text-amber-800 dark:text-amber-300 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                                    >
                                      <Phone className="w-3.5 h-3.5" />
                                      Registrar Contacto
                                    </button>
                                  )}
                                  {stageKey === 'CONTACTADA' && canConvert && !opp.linkedApplicationId && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openItem(item, 'convert');
                                      }}
                                      className="w-full py-1.5 px-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                                    >
                                      <ArrowRightCircle className="w-3.5 h-3.5" />
                                      Convertir en Solicitud
                                    </button>
                                  )}
                                  {stageKey === 'CONVERTIDA' && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onNavigateSection(liveLinkedLoan ? 'loans' : 'applications');
                                      }}
                                      className="w-full py-1.5 px-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold inline-flex items-center justify-center gap-1"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                      {liveLinkedLoan ? 'Ver Préstamo Real' : 'Ver Solicitud Real'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            /* Operational List View */
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-left text-slate-500">
                      <th className="py-2.5 px-3 font-medium">Cliente / Código</th>
                      <th className="py-2.5 px-3 font-medium">Etapa Ciclo</th>
                      <th className="py-2.5 px-3 font-medium">Vínculo Real AxyCore</th>
                      <th className="py-2.5 px-3 font-medium">Responsable</th>
                      <th className="py-2.5 px-3 font-medium text-right">Sugerido</th>
                      <th className="py-2.5 px-3 font-medium text-right">Trazabilidad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {filteredItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-slate-500">
                          No hay oportunidades en seguimiento para los filtros activos.
                        </td>
                      </tr>
                    ) : (
                      filteredItems.map((item) => {
                        const { opp, liveLinkedApplication, liveLinkedLoan, liveSourceLoan, syncState } =
                          item;
                        const isSelected = selectedItem?.opp.id === opp.id;
                        return (
                          <tr
                            key={opp.id}
                            onClick={() => openItem(item)}
                            className={`cursor-pointer ${
                              isSelected
                                ? 'bg-blue-50/70 dark:bg-blue-950/40'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <td className="py-3 px-3">
                              <div className="font-semibold text-slate-900 dark:text-white">
                                {opp.customerName}
                              </div>
                              <div className="text-[11px] text-slate-500 tabular-nums">
                                {opp.opportunityCode} · {IMPULSA_CATEGORY_LABELS[opp.category]}
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-semibold text-slate-900 dark:text-white">
                                {IMPULSA_STATUS_LABELS[opp.status]}
                              </div>
                              {syncState.needsSync && (
                                <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
                                  Sync → {IMPULSA_STATUS_LABELS[syncState.expectedStatus]}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 tabular-nums text-[11px]">
                              {liveLinkedApplication ? (
                                <div className="text-emerald-700 dark:text-emerald-400 font-medium">
                                  {liveLinkedApplication.applicationNumber} ({liveLinkedApplication.status})
                                  {liveLinkedLoan ? ` · ${liveLinkedLoan.loanNumber}` : ''}
                                </div>
                              ) : liveSourceLoan ? (
                                <div className="text-slate-600 dark:text-slate-400">
                                  Origen: {liveSourceLoan.loanNumber} · Saldo{' '}
                                  {fmtMoney(liveSourceLoan.currentPrincipalBalance, liveSourceLoan.currency)}
                                </div>
                              ) : (
                                <span className="text-slate-400">Expediente cliente</span>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <div>{opp.assignedOfficerName || 'Sin asignar'}</div>
                              {opp.nextFollowUpDate && (
                                <div className="text-[11px] text-slate-500 tabular-nums">
                                  Próx.: {opp.nextFollowUpDate}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right font-semibold tabular-nums">
                              {fmtMoney(opp.suggestedAmount, opp.currency)}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums text-slate-500">
                              {opp.followUpHistory.length} evento(s)
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Selected Opportunity Lifecycle & End-to-End Traceability Drawer */}
        {selectedItem && (
          <div className="xl:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                      {selectedItem.opp.opportunityCode}
                    </span>
                    <span className={`font-semibold ${PRIORITY_TEXT[selectedItem.opp.priority]}`}>
                      Prioridad {IMPULSA_PRIORITY_LABELS[selectedItem.opp.priority]}
                    </span>
                    <span className="text-slate-500">·</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {IMPULSA_STATUS_LABELS[selectedItem.opp.status]}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                    {selectedItem.opp.customerName}
                  </h3>
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>
                      Doc:{' '}
                      {selectedItem.liveCustomer?.documentNumber ||
                        selectedItem.opp.customerDocument ||
                        'N/D'}
                    </span>
                    <span>
                      Tel: {selectedItem.liveCustomer?.phone || selectedItem.opp.customerPhone || 'N/D'}
                    </span>
                    <span>{selectedItem.opp.branchOrProvince}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectOpportunity(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 4-Step Lifecycle Milestone Stepper */}
              <div className="mt-4 grid grid-cols-4 gap-1.5">
                {[
                  {
                    label: '1. Detectada',
                    done: true,
                    meta: fmtShortDate(selectedItem.opp.detectedAtIso),
                  },
                  {
                    label: '2. Asignada',
                    done: Boolean(selectedItem.opp.assignedOfficerId),
                    meta: selectedItem.opp.assignedOfficerName || 'Pendiente',
                  },
                  {
                    label: '3. Contactada',
                    done: Boolean(
                      selectedItem.opp.lastContactAtIso ||
                        selectedItem.macroStage === 'CONTACTADA' ||
                        selectedItem.macroStage === 'CONVERTIDA'
                    ),
                    meta: selectedItem.opp.lastContactAtIso
                      ? fmtShortDate(selectedItem.opp.lastContactAtIso)
                      : 'Sin contacto',
                  },
                  {
                    label: '4. Solicitud',
                    done: Boolean(selectedItem.opp.linkedApplicationId),
                    meta:
                      selectedItem.liveLinkedLoan?.loanNumber ||
                      selectedItem.liveLinkedApplication?.applicationNumber ||
                      selectedItem.opp.linkedApplicationNumber ||
                      'Pendiente',
                  },
                ].map((step) => (
                  <div
                    key={step.label}
                    className={`rounded-lg border p-2 ${
                      step.done
                        ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-1 text-[10px] font-bold text-slate-800 dark:text-slate-200">
                      {step.done ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                      ) : (
                        <span className="w-2.5 h-2.5 rounded-full border border-slate-400 shrink-0" />
                      )}
                      <span className="truncate">{step.label}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5 tabular-nums">
                      {step.meta}
                    </div>
                  </div>
                ))}
              </div>

              {feedback && (
                <div
                  className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-2 ${
                    feedback.type === 'ok'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900'
                      : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900'
                  }`}
                >
                  {feedback.type === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{feedback.text}</span>
                </div>
              )}
            </div>

            <div className="p-4 space-y-4 max-h-[72vh] overflow-y-auto">
              {/* Live AxyCore Cross-Reference Card */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Vínculo en Vivo con AxyCore
                  </span>
                  {selectedItem.syncState.needsSync && canManage && (
                    <button
                      type="button"
                      disabled={busyAction === 'sync'}
                      onClick={() => void handleGlobalSync([selectedItem.opp])}
                      className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Sincronizar estado
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
                  <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2">
                    <div className="text-[10px] text-slate-500">Préstamo Origen</div>
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {selectedItem.liveSourceLoan?.loanNumber ||
                        selectedItem.opp.sourceLoanNumber ||
                        'Cartera general'}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Saldo:{' '}
                      {fmtMoney(
                        selectedItem.liveSourceLoan?.currentPrincipalBalance ??
                          selectedItem.opp.currentLoanBalance,
                        selectedItem.opp.currency
                      )}{' '}
                      · DPD {selectedItem.liveCollectionAccount?.dpd ?? selectedItem.opp.currentDpd}d
                    </div>
                  </div>

                  <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2">
                    <div className="text-[10px] text-slate-500">Solicitud / Desembolso</div>
                    {selectedItem.liveLinkedApplication ? (
                      <>
                        <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                          {selectedItem.liveLinkedApplication.applicationNumber}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {selectedItem.liveLinkedApplication.status}
                          {typeof selectedItem.liveLinkedApplication.latestScore === 'number'
                            ? ` · Score V2: ${selectedItem.liveLinkedApplication.latestScore}`
                            : ''}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-semibold text-slate-600 dark:text-slate-400">
                          Sin convertir
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Sugerido: {fmtMoney(selectedItem.opp.suggestedAmount, selectedItem.opp.currency)}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {selectedItem.liveOpenAlerts.length > 0 && (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-2 text-[11px] text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                      {selectedItem.liveOpenAlerts.length} alerta(s) Centinela activa(s) en este cliente.
                    </span>
                    <button
                      type="button"
                      onClick={() => onNavigateSection('cobranza_sentinel')}
                      className="font-semibold underline shrink-0"
                    >
                      Ver Centinela
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onNavigateSection('customers')}
                    className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                  >
                    Ver Cliente <ExternalLink className="w-3 h-3" />
                  </button>
                  {selectedItem.liveSourceLoan && (
                    <button
                      type="button"
                      onClick={() => onNavigateSection('loans')}
                      className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                    >
                      Ver Préstamo <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                  {selectedItem.liveLinkedApplication && (
                    <button
                      type="button"
                      onClick={() =>
                        onNavigateSection(
                          selectedItem.liveLinkedApplication?.status === 'EN_EVALUACION'
                            ? 'evaluation'
                            : selectedItem.liveLinkedApplication?.status === 'EN_COMITE'
                            ? 'committee'
                            : 'applications'
                        )
                      }
                      className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
                    >
                      Abrir Solicitud en Flujo <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Guided Action Switcher (Asignar | Registrar Contacto | Convertir en Solicitud) */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="grid grid-cols-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setActiveActionTab('assign')}
                    className={`py-2.5 px-2 text-center transition-colors ${
                      activeActionTab === 'assign'
                        ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 border-b-2 border-blue-600'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    1. Asignar
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveActionTab('contact')}
                    className={`py-2.5 px-2 text-center transition-colors ${
                      activeActionTab === 'contact'
                        ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 border-b-2 border-blue-600'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    2. Contactar
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveActionTab('convert')}
                    className={`py-2.5 px-2 text-center transition-colors ${
                      activeActionTab === 'convert'
                        ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-600'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    3. Convertir
                  </button>
                </div>

                <div className="p-3.5">
                  {isLockedByOther && (
                    <div className="mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-2.5 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                      <Lock className="w-4 h-4 shrink-0" />
                      <span>
                        Bloqueo anti-colisión: asignada exclusivamente a{' '}
                        <strong>{selectedItem.opp.assignedOfficerName}</strong>.
                      </span>
                    </div>
                  )}

                  {activeActionTab === 'assign' && (
                    <form onSubmit={handleAssignSubmit} className="space-y-2.5">
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        Asigna un oficial responsable único para avanzar de{' '}
                        <strong>Detectada → Asignada</strong> con control de exclusividad.
                      </div>
                      <select
                        value={assignOfficerId}
                        onChange={(e) => setAssignOfficerId(e.target.value)}
                        disabled={!canAssign || isLockedByOther}
                        className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                      >
                        {assignableOfficers.map((u) => (
                          <option key={u.uid} value={u.uid}>
                            {u.displayName || u.email} ({u.role})
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={assignReason}
                        onChange={(e) => setAssignReason(e.target.value)}
                        disabled={isLockedByOther}
                        placeholder="Motivo o instrucción para el oficial..."
                        className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                      />
                      <button
                        type="submit"
                        disabled={
                          busyAction === 'assign' ||
                          isLockedByOther ||
                          (!canAssign && Boolean(selectedItem.opp.assignedOfficerId))
                        }
                        className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        {selectedItem.opp.assignedOfficerId
                          ? 'Reasignar Responsable'
                          : 'Asignar y Avanzar a Asignada'}
                      </button>
                    </form>
                  )}

                  {activeActionTab === 'contact' && (
                    <form onSubmit={handleContactSubmit} className="space-y-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">
                            Estado de Seguimiento
                          </label>
                          <select
                            value={fuStatus}
                            disabled={!canManage || isLockedByOther}
                            onChange={(e) =>
                              setFuStatus(e.target.value as ImpulsaOpportunityStatus)
                            }
                            className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5"
                          >
                            {IMPULSA_ALL_STATUSES.map((st) => (
                              <option key={st} value={st}>
                                {IMPULSA_STATUS_LABELS[st]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">
                            Canal de Contacto
                          </label>
                          <select
                            value={fuChannel}
                            disabled={!canManage || isLockedByOther}
                            onChange={(e) => setFuChannel(e.target.value as ImpulsaContactChannel)}
                            className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5"
                          >
                            <option value="LLAMADA">Llamada telefónica</option>
                            <option value="WHATSAPP">WhatsApp (autorizado)</option>
                            <option value="EMAIL">Correo electrónico</option>
                            <option value="VISITA_OFICINA">Visita en oficina</option>
                            <option value="VISITA_CAMPO">Visita en campo</option>
                            <option value="INTERNO">Nota interna</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Resultado</label>
                          <input
                            type="text"
                            value={fuOutcome}
                            disabled={!canManage || isLockedByOther}
                            onChange={(e) => setFuOutcome(e.target.value)}
                            placeholder="Ej. Cliente interesado en renovar"
                            className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">
                            Próximo Seguimiento
                          </label>
                          <div className="relative">
                            <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                              type="date"
                              value={fuNextDate}
                              disabled={!canManage || isLockedByOther}
                              onChange={(e) => setFuNextDate(e.target.value)}
                              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-8 pr-2 py-1.5"
                            />
                          </div>
                        </div>
                      </div>

                      <textarea
                        rows={2}
                        value={fuComment}
                        disabled={!canManage || isLockedByOther}
                        onChange={(e) => setFuComment(e.target.value)}
                        placeholder="Detalle del contacto, respuesta del cliente o motivo de cambio de estado (obligatorio)..."
                        className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                      />

                      <button
                        type="submit"
                        disabled={busyAction === 'contact' || !canManage || isLockedByOther}
                        className="w-full py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:opacity-90 disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {busyAction === 'contact'
                          ? 'Registrando trazabilidad...'
                          : 'Guardar Gestión y Actualizar Estado'}
                      </button>
                    </form>
                  )}

                  {activeActionTab === 'convert' && (
                    <div className="space-y-3">
                      {selectedItem.opp.linkedApplicationId ? (
                        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 p-3 text-xs space-y-1.5">
                          <div className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4" />
                            Convertida en {selectedItem.opp.linkedApplicationNumber}
                          </div>
                          <div className="text-emerald-700 dark:text-emerald-400">
                            Estado real en AxyCore:{' '}
                            <strong>
                              {selectedItem.liveLinkedApplication?.status ||
                                selectedItem.opp.linkedApplicationStatus}
                            </strong>
                            {selectedItem.liveLinkedLoan &&
                              ` · Préstamo desembolsado ${selectedItem.liveLinkedLoan.loanNumber} (${fmtMoney(
                                selectedItem.liveLinkedLoan.approvedPrincipal,
                                selectedItem.liveLinkedLoan.currency
                              )})`}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              onNavigateSection(
                                selectedItem.liveLinkedLoan ? 'loans' : 'applications'
                              )
                            }
                            className="mt-1 inline-flex items-center gap-1 font-semibold text-emerald-800 dark:text-emerald-300 underline"
                          >
                            Ir al expediente real <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[11px] text-slate-500 mb-1">
                                Producto vigente
                              </label>
                              <select
                                value={convProduct}
                                onChange={(e) => setConvProduct(e.target.value as ProductCode)}
                                className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5"
                              >
                                {(Object.keys(policy.products) as ProductCode[]).map((code) => (
                                  <option key={code} value={code}>
                                    {policy.products[code].label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[11px] text-slate-500 mb-1">
                                Monto solicitado
                              </label>
                              <input
                                type="number"
                                value={convAmount}
                                onChange={(e) => setConvAmount(Number(e.target.value))}
                                className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 tabular-nums"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-slate-500 mb-1">
                                Plazo (meses)
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={120}
                                value={convTerm}
                                onChange={(e) => setConvTerm(Number(e.target.value))}
                                className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 tabular-nums"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-slate-500 mb-1">
                                Frecuencia
                              </label>
                              <select
                                value={convFreq}
                                onChange={(e) => setConvFreq(e.target.value as PaymentFrequency)}
                                className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5"
                              >
                                <option value="MENSUAL">Mensual</option>
                                <option value="QUINCENAL">Quincenal</option>
                                <option value="SEMANAL">Semanal</option>
                                <option value="DIARIA">Diaria</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-1">
                              Propósito / Referencia trazable
                            </label>
                            <input
                              type="text"
                              value={convPurpose}
                              onChange={(e) => setConvPurpose(e.target.value)}
                              className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
                            />
                          </div>
                          <p className="text-[11px] text-slate-500">
                            Reutiliza el cliente real ({selectedItem.opp.customerId}) y envía la solicitud íntegra al Motor de Decisiones V2 sin alterar políticas.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busyAction === 'convert' || !canConvert || isLockedByOther}
                              onClick={() => void handleConvertSubmit('SUBMIT')}
                              className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold"
                            >
                              {busyAction === 'convert'
                                ? 'Ejecutando Motor V2...'
                                : 'Convertir y Someter a Motor V2'}
                            </button>
                            <button
                              type="button"
                              disabled={busyAction === 'convert' || !canConvert || isLockedByOther}
                              onClick={() => void handleConvertSubmit('DRAFT')}
                              className="py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
                            >
                              Borrador
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Unified Immutable Traceability Ledger */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 inline-flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" />
                    Trazabilidad Completa ({selectedItem.opp.followUpHistory.length} gestión(es) ·{' '}
                    {selectedItem.auditTrail.length} auditoría)
                  </h4>
                </div>

                {selectedItem.opp.followUpHistory.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-3 text-xs text-slate-500">
                    Detectada el {fmtShortDate(selectedItem.opp.detectedAtIso)}. Aún sin gestiones registradas.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[...selectedItem.opp.followUpHistory].reverse().map((h) => (
                      <div
                        key={h.id}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {h.actorName} ({h.actorRole}) · {h.channel}
                          </span>
                          <span className="tabular-nums">{fmtShortDate(h.timestampIso)}</span>
                        </div>
                        <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 mt-0.5">
                          {IMPULSA_STATUS_LABELS[h.previousStatus]} →{' '}
                          {IMPULSA_STATUS_LABELS[h.newStatus]} · {h.outcome}
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                          {h.comment}
                        </p>
                        {h.nextFollowUpDate && (
                          <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                            Próximo seguimiento agendado: {h.nextFollowUpDate}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {selectedItem.auditTrail.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-500">
                      Registros Inmutables en Bitácora de Auditoría
                    </div>
                    {selectedItem.auditTrail.slice(0, 6).map((log) => (
                      <div
                        key={log.id}
                        className="rounded-lg border border-slate-200/80 dark:border-slate-800 px-2.5 py-1.5 text-[11px] flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <span className="font-mono text-[10px] text-slate-400 mr-1.5">
                            {log.transactionId.slice(0, 12)}
                          </span>
                          <span className="text-slate-700 dark:text-slate-300">{log.action}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {log.userEmail || log.userId.slice(0, 8)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
