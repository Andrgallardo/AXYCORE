import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightCircle,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Filter,
  History,
  Lock,
  Phone,
  Search,
  Send,
  ShieldAlert,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  AmortizationMethod,
  CreditPolicyRecord,
  NavSectionId,
  PaymentFrequency,
  ProductCode,
  UserProfile,
} from '../../types/axycore';
import {
  IMPULSA_ALL_STATUSES,
  IMPULSA_CATEGORY_LABELS,
  IMPULSA_PRIORITY_LABELS,
  IMPULSA_STATUS_LABELS,
  type ImpulsaContactChannel,
  type ImpulsaOpportunityCategory,
  type ImpulsaOpportunityRecord,
  type ImpulsaOpportunityStatus,
  type ImpulsaPriority,
} from '../../types/impulsa';
import { hasRolePermission } from '../../engine/rbac';

interface ImpulsaOpportunitiesTabProps {
  mode: 'opportunities' | 'crm';
  opportunities: ImpulsaOpportunityRecord[];
  selectedOpportunityId: string | null;
  onSelectOpportunity: (id: string | null) => void;
  usersList: UserProfile[];
  currentUser: UserProfile;
  policy: CreditPolicyRecord;
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
  }) => Promise<{ application: { id: string; applicationNumber: string; status: string }; scoring?: { totalScore: number } }>;
  onNavigateSection: (section: NavSectionId) => void;
}

const PRIORITY_STYLE: Record<ImpulsaPriority, string> = {
  CRITICA: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-900',
  ALTA: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900',
  MEDIA: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-900',
  BAJA: 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
};

function fmtCurrency(amount: number, currency: string): string {
  const prefix = currency === 'USD' ? 'US$' : 'RD$';
  return `${prefix}${Math.round(amount || 0).toLocaleString('en-US')}`;
}

export const ImpulsaOpportunitiesTab: React.FC<ImpulsaOpportunitiesTabProps> = ({
  mode,
  opportunities,
  selectedOpportunityId,
  onSelectOpportunity,
  usersList,
  currentUser,
  policy,
  onAssign,
  onLogFollowUp,
  onConvertToApplication,
  onNavigateSection,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ImpulsaOpportunityCategory | 'ALL'>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<ImpulsaPriority | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<ImpulsaOpportunityStatus | 'ALL'>('ALL');
  const [officerFilter, setOfficerFilter] = useState<string>('ALL');
  const [onlyMine, setOnlyMine] = useState(false);

  // Action states inside detail dossier
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Assignment form
  const [assignOfficerId, setAssignOfficerId] = useState('');
  const [assignReason, setAssignReason] = useState('');

  // Follow-up form
  const [fuStatus, setFuStatus] = useState<ImpulsaOpportunityStatus>('CONTACTADA');
  const [fuChannel, setFuChannel] = useState<ImpulsaContactChannel>('LLAMADA');
  const [fuOutcome, setFuOutcome] = useState('');
  const [fuComment, setFuComment] = useState('');
  const [fuNextDate, setFuNextDate] = useState('');

  // Conversion modal/panel state
  const [showConvertPanel, setShowConvertPanel] = useState(false);
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
          u.status === 'ACTIVE' &&
          u.role !== 'EXTERNAL_CLIENT' &&
          u.role !== 'AUDITOR'
      ),
    [usersList]
  );

  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of IMPULSA_ALL_STATUSES) map[s] = 0;
    for (const o of opportunities) map[o.status] = (map[o.status] || 0) + 1;
    return map;
  }, [opportunities]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return opportunities.filter((opp) => {
      if (categoryFilter !== 'ALL' && opp.category !== categoryFilter) return false;
      if (priorityFilter !== 'ALL' && opp.priority !== priorityFilter) return false;
      if (statusFilter !== 'ALL' && opp.status !== statusFilter) return false;
      if (onlyMine && opp.assignedOfficerId !== currentUser.uid) return false;
      if (officerFilter === 'UNASSIGNED' && opp.assignedOfficerId) return false;
      if (officerFilter !== 'ALL' && officerFilter !== 'UNASSIGNED' && opp.assignedOfficerId !== officerFilter) {
        return false;
      }
      if (q) {
        const hay = `${opp.customerName} ${opp.opportunityCode} ${opp.customerDocument || ''} ${opp.sourceLoanNumber || ''} ${opp.branchOrProvince} ${opp.assignedOfficerName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    opportunities,
    searchTerm,
    categoryFilter,
    priorityFilter,
    statusFilter,
    onlyMine,
    officerFilter,
    currentUser.uid,
  ]);

  const selectedOpp = useMemo(
    () => opportunities.find((o) => o.id === selectedOpportunityId) || null,
    [opportunities, selectedOpportunityId]
  );

  const openDossier = (opp: ImpulsaOpportunityRecord) => {
    onSelectOpportunity(opp.id);
    setActionFeedback(null);
    setShowConvertPanel(false);
    setAssignOfficerId(opp.assignedOfficerId || currentUser.uid);
    setAssignReason('');
    setFuStatus(opp.status === 'DETECTADA' || opp.status === 'ASIGNADA' ? 'CONTACTADA' : opp.status);
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
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOpp) return;
    const target = assignableOfficers.find((u) => u.uid === assignOfficerId);
    if (!target) {
      setActionFeedback({ type: 'err', text: 'Selecciona un oficial válido.' });
      return;
    }
    setBusyAction('assign');
    setActionFeedback(null);
    try {
      await onAssign({
        opportunity: selectedOpp,
        targetOfficer: {
          uid: target.uid,
          displayName: target.displayName || target.email,
        },
        reason: assignReason,
      });
      setAssignReason('');
      setActionFeedback({
        type: 'ok',
        text: `Oportunidad asignada a ${target.displayName || target.email} con control exclusivo.`,
      });
    } catch (err) {
      setActionFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo asignar la oportunidad.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleFollowUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOpp) return;
    if (!fuComment.trim()) {
      setActionFeedback({ type: 'err', text: 'Registra un comentario o resultado de la gestión.' });
      return;
    }
    setBusyAction('followup');
    setActionFeedback(null);
    try {
      await onLogFollowUp({
        opportunity: selectedOpp,
        newStatus: fuStatus,
        channel: fuChannel,
        outcome: fuOutcome.trim() || IMPULSA_STATUS_LABELS[fuStatus],
        comment: fuComment.trim(),
        nextFollowUpDate: fuNextDate || null,
      });
      setFuOutcome('');
      setFuComment('');
      setActionFeedback({
        type: 'ok',
        text: `Seguimiento guardado · Nuevo estado: ${IMPULSA_STATUS_LABELS[fuStatus]}.`,
      });
    } catch (err) {
      setActionFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo registrar el seguimiento.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleConvertSubmit = async (submitMode: 'SUBMIT' | 'DRAFT') => {
    if (!selectedOpp) return;
    setBusyAction('convert');
    setActionFeedback(null);
    try {
      const res = await onConvertToApplication({
        opportunity: selectedOpp,
        productCode: convProduct,
        requestedAmount: Number(convAmount),
        requestedTermMonths: Number(convTerm),
        paymentFrequency: convFreq,
        amortizationMethod: convAmort,
        loanPurposeNote: convPurpose,
        submitMode,
      });
      setShowConvertPanel(false);
      setActionFeedback({
        type: 'ok',
        text: `Solicitud ${res.application.applicationNumber} creada (${res.application.status})${
          res.scoring ? ` · Score Motor V2: ${res.scoring.totalScore}/100` : ''
        }. Cliente reutilizado sin duplicación.`,
      });
    } catch (err) {
      setActionFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Error al convertir oportunidad en solicitud.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const isLockedByOtherOfficer = Boolean(
    selectedOpp?.assignedOfficerId &&
      selectedOpp.assignedOfficerId !== currentUser.uid &&
      !canAssign
  );

  return (
    <div className="space-y-4">
      {/* 14-State CRM Strip (shown prominently in CRM mode, compact filter in Detector mode) */}
      {mode === 'crm' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Ciclo de Vida Comercial (14 Estados Oficiales)
            </h3>
            {statusFilter !== 'ALL' && (
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Ver todos ({opportunities.length})
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {IMPULSA_ALL_STATUSES.map((st) => {
              const active = statusFilter === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(active ? 'ALL' : st)}
                  className={`text-left rounded-lg border px-2.5 py-2 transition-colors ${
                    active
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="text-[11px] leading-tight truncate">{IMPULSA_STATUS_LABELS[st]}</div>
                  <div className="text-base font-bold tabular-nums mt-0.5">{statusCounts[st] || 0}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar cliente, código IMP, cédula, préstamo o sucursal..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as ImpulsaOpportunityCategory | 'ALL')}
              className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-slate-800 dark:text-slate-200"
            >
              <option value="ALL">Todas las categorías (7)</option>
              {(Object.keys(IMPULSA_CATEGORY_LABELS) as ImpulsaOpportunityCategory[]).map((k) => (
                <option key={k} value={k}>
                  {IMPULSA_CATEGORY_LABELS[k]}
                </option>
              ))}
            </select>

            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as ImpulsaPriority | 'ALL')}
              className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-slate-800 dark:text-slate-200"
            >
              <option value="ALL">Todas las prioridades</option>
              {(['CRITICA', 'ALTA', 'MEDIA', 'BAJA'] as ImpulsaPriority[]).map((p) => (
                <option key={p} value={p}>
                  Prioridad {IMPULSA_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>

            {mode === 'opportunities' && (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ImpulsaOpportunityStatus | 'ALL')}
                className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-slate-800 dark:text-slate-200"
              >
                <option value="ALL">Todos los estados (14)</option>
                {IMPULSA_ALL_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {IMPULSA_STATUS_LABELS[st]}
                  </option>
                ))}
              </select>
            )}

            <select
              value={officerFilter}
              onChange={(e) => setOfficerFilter(e.target.value)}
              className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-slate-800 dark:text-slate-200"
            >
              <option value="ALL">Todos los oficiales</option>
              <option value="UNASSIGNED">Sin asignar</option>
              {assignableOfficers.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName || u.email}
                </option>
              ))}
            </select>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyMine}
                onChange={(e) => setOnlyMine(e.target.checked)}
                className="rounded border-slate-300"
              />
              Mis asignadas
            </label>
          </div>
        </div>
      </div>

      {/* Main Split Workspace: List + Explainable Dossier */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Table / List */}
        <div
          className={`${
            selectedOpp ? 'xl:col-span-7' : 'xl:col-span-12'
          } rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden`}
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {filtered.length} oportunidad(es) encontrada(s)
            </span>
            <span className="text-[11px] text-slate-500">
              Ordenadas por prioridad comercial · Clic para abrir expediente
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No hay oportunidades que coincidan con los filtros actuales.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-left text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-3 font-medium">Cliente / Código</th>
                    <th className="py-2.5 px-3 font-medium">Oportunidad</th>
                    <th className="py-2.5 px-3 font-medium text-right">Monto Sugerido</th>
                    <th className="py-2.5 px-3 font-medium">Prioridad</th>
                    <th className="py-2.5 px-3 font-medium">Estado CRM</th>
                    <th className="py-2.5 px-3 font-medium">Responsable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {filtered.map((opp) => {
                    const isSelected = opp.id === selectedOpp?.id;
                    return (
                      <tr
                        key={opp.id}
                        onClick={() => openDossier(opp)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-50/80 dark:bg-blue-950/40'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span>{opp.customerName}</span>
                            {opp.centinelaAlertsCount > 0 && (
                              <ShieldAlert
                                className="w-3.5 h-3.5 text-amber-500 shrink-0"
                                aria-label="Alerta Centinela vinculada"
                              />
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 tabular-nums">
                            {opp.opportunityCode} · {opp.branchOrProvince}
                            {opp.sourceLoanNumber ? ` · ${opp.sourceLoanNumber}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {IMPULSA_CATEGORY_LABELS[opp.category]}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[240px]">
                            {opp.recommendedProductLabel} · {opp.suggestedTermMonths}m
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {fmtCurrency(opp.suggestedAmount, opp.currency)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Prob. com. {opp.commercialConversionProbability}%
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${PRIORITY_STYLE[opp.priority]}`}
                          >
                            {IMPULSA_PRIORITY_LABELS[opp.priority]} · {opp.priorityScore}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {IMPULSA_STATUS_LABELS[opp.status]}
                          </div>
                          {opp.linkedApplicationNumber && (
                            <div className="text-[11px] text-emerald-600 dark:text-emerald-400 tabular-nums">
                              {opp.linkedApplicationNumber}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <div className="text-slate-800 dark:text-slate-200">
                            {opp.assignedOfficerName || (
                              <span className="text-amber-600 dark:text-amber-400 font-medium">
                                Sin asignar
                              </span>
                            )}
                          </div>
                          {opp.nextFollowUpDate && (
                            <div className="text-[11px] text-slate-500 tabular-nums">
                              Próx.: {opp.nextFollowUpDate}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Explainable Smart Dossier Panel */}
        {selectedOpp && (
          <div className="xl:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            {/* Dossier Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono font-semibold text-blue-600 dark:text-blue-400">
                      {selectedOpp.opportunityCode}
                    </span>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${PRIORITY_STYLE[selectedOpp.priority]}`}
                    >
                      {IMPULSA_PRIORITY_LABELS[selectedOpp.priority]}
                    </span>
                    <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                      {IMPULSA_STATUS_LABELS[selectedOpp.status]}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1">
                    {selectedOpp.customerName}
                  </h3>
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {selectedOpp.customerDocument && <span>Doc: {selectedOpp.customerDocument}</span>}
                    {selectedOpp.customerPhone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {selectedOpp.customerPhone}
                      </span>
                    )}
                    <span>{selectedOpp.branchOrProvince}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectOpportunity(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                  title="Cerrar expediente"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Action Feedback */}
              {actionFeedback && (
                <div
                  className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-2 ${
                    actionFeedback.type === 'ok'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900'
                      : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900'
                  }`}
                >
                  {actionFeedback.type === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{actionFeedback.text}</span>
                </div>
              )}

              {/* Primary CTA: CONVERTIR EN SOLICITUD or Linked Application Banner */}
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedOpp.linkedApplicationId ? (
                  <div className="w-full rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 p-2.5 flex items-center justify-between gap-2">
                    <div className="text-xs">
                      <div className="font-semibold text-emerald-800 dark:text-emerald-300">
                        Solicitud Vinculada: {selectedOpp.linkedApplicationNumber}
                      </div>
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                        Estado actual en AxyCore: {selectedOpp.linkedApplicationStatus || 'EN_TRAMITE'}
                        {selectedOpp.linkedLoanNumber ? ` · Préstamo ${selectedOpp.linkedLoanNumber}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onNavigateSection(selectedOpp.linkedLoanId ? 'loans' : 'applications')
                      }
                      className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:underline inline-flex items-center gap-1 shrink-0"
                    >
                      Abrir
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  canConvert && (
                    <button
                      type="button"
                      onClick={() => setShowConvertPanel((v) => !v)}
                      disabled={isLockedByOtherOfficer}
                      className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      <ArrowRightCircle className="w-4 h-4" />
                      {showConvertPanel ? 'Ocultar Conversión' : 'CONVERTIR EN SOLICITUD (Motor V2)'}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="p-4 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Conversion Inline Panel */}
              {showConvertPanel && !selectedOpp.linkedApplicationId && (
                <div className="rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wide text-blue-800 dark:text-blue-300">
                      Originación Directa desde Impulsa
                    </h4>
                    <span className="text-[11px] text-slate-500">Reutiliza cliente existente</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Producto vigente
                      </label>
                      <select
                        value={convProduct}
                        onChange={(e) => setConvProduct(e.target.value as ProductCode)}
                        className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                      >
                        {(Object.keys(policy.products) as ProductCode[]).map((code) => (
                          <option key={code} value={code}>
                            {policy.products[code].label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Monto solicitado
                      </label>
                      <input
                        type="number"
                        value={convAmount}
                        onChange={(e) => setConvAmount(Number(e.target.value))}
                        className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Plazo (meses)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={120}
                        value={convTerm}
                        onChange={(e) => setConvTerm(Number(e.target.value))}
                        className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Frecuencia
                      </label>
                      <select
                        value={convFreq}
                        onChange={(e) => setConvFreq(e.target.value as PaymentFrequency)}
                        className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                      >
                        <option value="MENSUAL">Mensual</option>
                        <option value="QUINCENAL">Quincenal</option>
                        <option value="SEMANAL">Semanal</option>
                        <option value="DIARIA">Diaria</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Nota / Destino de la solicitud
                    </label>
                    <input
                      type="text"
                      value={convPurpose}
                      onChange={(e) => setConvPurpose(e.target.value)}
                      className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                    />
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                    Impulsa no aprueba créditos ni altera políticas. La solicitud se someterá íntegra al Motor de Decisiones V2.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyAction === 'convert'}
                      onClick={() => handleConvertSubmit('SUBMIT')}
                      className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
                    >
                      {busyAction === 'convert' ? 'Procesando Motor V2...' : 'Someter a Motor V2'}
                    </button>
                    <button
                      type="button"
                      disabled={busyAction === 'convert'}
                      onClick={() => handleConvertSubmit('DRAFT')}
                      className="py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200"
                    >
                      Crear Borrador
                    </button>
                  </div>
                </div>
              )}

              {/* Offer Summary Cards */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Recomendación Comercial Explicable
                </h4>
                <div className="grid grid-cols-2 gap-2.5">
                  <MetricCell
                    label="Producto Sugerido"
                    value={selectedOpp.recommendedProductLabel}
                  />
                  <MetricCell
                    label="Monto / Plazo Sugerido"
                    value={`${fmtCurrency(selectedOpp.suggestedAmount, selectedOpp.currency)} · ${selectedOpp.suggestedTermMonths}m`}
                  />
                  <MetricCell
                    label="Cuota Est. / Tasa Mens."
                    value={`${fmtCurrency(selectedOpp.estimatedInstallment, selectedOpp.currency)} (${selectedOpp.estimatedMonthlyRatePct}%)`}
                  />
                  <MetricCell
                    label="Capacidad / DTI Proy."
                    value={`${fmtCurrency(selectedOpp.estimatedPaymentCapacity, selectedOpp.currency)} · ${
                      selectedOpp.estimatedProjectedDtiPct !== null &&
                      selectedOpp.estimatedProjectedDtiPct !== undefined
                        ? `${selectedOpp.estimatedProjectedDtiPct}%`
                        : 'Verificar'
                    }`}
                  />
                  <MetricCell
                    label="Probabilidad Comercial"
                    value={`${selectedOpp.commercialConversionProbability}% (Confianza ${selectedOpp.confidenceScore}%)`}
                  />
                  <MetricCell
                    label="Rentabilidad Est."
                    value={fmtCurrency(selectedOpp.estimatedNetProfit, selectedOpp.currency)}
                  />
                </div>
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 italic">
                  {selectedOpp.creditApprovalDisclaimer}
                </p>
              </div>

              {/* Why Detected + Evidence */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  ¿Por qué Impulsa detectó esta oportunidad?
                </h4>
                <p className="text-xs font-medium text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-950/60 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                  {selectedOpp.summaryReason}
                </p>
                <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300 list-disc pl-4">
                  {selectedOpp.detailedReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                {selectedOpp.evidenceMetrics.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {selectedOpp.evidenceMetrics.map((ev, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 p-2"
                      >
                        <div className="text-[10px] text-slate-500">{ev.label}</div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white tabular-nums">
                          {ev.value}
                        </div>
                        <div className="text-[10px] text-slate-400">{ev.source}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Risks & Policy Checks */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Riesgos, Políticas y Señales de Centinela
                </h4>
                <div className="space-y-1.5">
                  {selectedOpp.policyNotes.map((note, idx) => (
                    <div
                      key={idx}
                      className={`text-xs rounded-lg p-2.5 border ${
                        selectedOpp.policyCompliant
                          ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
                          : 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      {note}
                    </div>
                  ))}
                  {selectedOpp.risksIdentified.map((risk, idx) => (
                    <div
                      key={idx}
                      className={`text-xs rounded-lg p-2.5 border flex items-start gap-2 ${
                        risk.severity === 'BLOCKER'
                          ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
                          : risk.severity === 'WARNING'
                          ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300'
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold">[{risk.source}]</span> {risk.detail}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 p-2.5 text-xs text-blue-900 dark:text-blue-200">
                  <span className="font-semibold">Próxima acción recomendada:</span>{' '}
                  {selectedOpp.nextRecommendedAction}
                </div>
              </div>

              {/* Assignment & Anti-Collision Lock */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5 text-blue-600" />
                    Responsable Comercial
                  </h4>
                  {selectedOpp.assignedOfficerId && (
                    <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      Exclusividad activa
                    </span>
                  )}
                </div>

                {isLockedByOtherOfficer ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Asignada exclusivamente a <strong>{selectedOpp.assignedOfficerName}</strong>. Solo un supervisor o administrador puede reasignarla para evitar colisiones de contacto.
                  </p>
                ) : (canAssign || (!selectedOpp.assignedOfficerId && canManage)) ? (
                  <form onSubmit={handleAssignSubmit} className="space-y-2">
                    <div className="flex gap-2">
                      <select
                        value={assignOfficerId}
                        onChange={(e) => setAssignOfficerId(e.target.value)}
                        disabled={!canAssign}
                        className="flex-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
                      >
                        {assignableOfficers.map((u) => (
                          <option key={u.uid} value={u.uid}>
                            {u.displayName || u.email} ({u.role})
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={busyAction === 'assign'}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                      >
                        {selectedOpp.assignedOfficerId ? 'Reasignar' : 'Asignar'}
                      </button>
                    </div>
                    <input
                      type="text"
                      value={assignReason}
                      onChange={(e) => setAssignReason(e.target.value)}
                      placeholder="Motivo de asignación / reasignación (opcional)..."
                      className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
                    />
                  </form>
                ) : (
                  <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5" />
                    {selectedOpp.assignedOfficerName || 'Sin asignar'}
                  </div>
                )}
              </div>

              {/* CRM Follow-up & 14-State Transition Form */}
              {canManage && !isLockedByOtherOfficer && (
                <form
                  onSubmit={handleFollowUpSubmit}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5"
                >
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5 text-blue-600" />
                    Registrar Gestión y Actualizar Estado
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Nuevo Estado</label>
                      <select
                        value={fuStatus}
                        onChange={(e) => setFuStatus(e.target.value as ImpulsaOpportunityStatus)}
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
                      <label className="block text-[11px] text-slate-500 mb-1">Canal</label>
                      <select
                        value={fuChannel}
                        onChange={(e) => setFuChannel(e.target.value as ImpulsaContactChannel)}
                        className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5"
                      >
                        <option value="LLAMADA">Llamada telefónica</option>
                        <option value="WHATSAPP">WhatsApp (con consentimiento)</option>
                        <option value="EMAIL">Correo electrónico</option>
                        <option value="VISITA_OFICINA">Visita en oficina</option>
                        <option value="VISITA_CAMPO">Visita en campo</option>
                        <option value="INTERNO">Nota interna</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Resultado breve</label>
                      <input
                        type="text"
                        value={fuOutcome}
                        onChange={(e) => setFuOutcome(e.target.value)}
                        placeholder="Ej. Interesado en renovar"
                        className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-1">Próximo seguimiento</label>
                      <div className="relative">
                        <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="date"
                          value={fuNextDate}
                          onChange={(e) => setFuNextDate(e.target.value)}
                          className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-8 pr-2 py-1.5"
                        />
                      </div>
                    </div>
                  </div>
                  <textarea
                    rows={2}
                    value={fuComment}
                    onChange={(e) => setFuComment(e.target.value)}
                    placeholder="Detalle del contacto, acuerdos con el cliente o motivo de descarte/reprogramación..."
                    className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                  />
                  <button
                    type="submit"
                    disabled={busyAction === 'followup'}
                    className="w-full py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    {busyAction === 'followup' ? 'Guardando gestión...' : 'Guardar Seguimiento Comercial'}
                  </button>
                </form>
              )}

              {/* Chronological Audit & Follow-up Timeline */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 inline-flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  Trazabilidad e Historial de Gestiones ({selectedOpp.followUpHistory.length})
                </h4>
                {selectedOpp.followUpHistory.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">
                    Aún no se han registrado contactos comerciales para esta oportunidad.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {[...selectedOpp.followUpHistory].reverse().map((h) => (
                      <div
                        key={h.id}
                        className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 mb-1">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {h.actorName} · {h.channel}
                          </span>
                          <span className="tabular-nums">
                            {new Date(h.timestampIso).toLocaleString('es-DO', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                        </div>
                        <div className="text-[11px] font-medium text-blue-700 dark:text-blue-400">
                          {IMPULSA_STATUS_LABELS[h.previousStatus]} → {IMPULSA_STATUS_LABELS[h.newStatus]} · {h.outcome}
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-300 mt-1">{h.comment}</p>
                        {h.nextFollowUpDate && (
                          <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                            Seguimiento agendado: {h.nextFollowUpDate}
                          </div>
                        )}
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

const MetricCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 p-2.5">
    <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
    <div className="text-xs font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">{value}</div>
  </div>
);
