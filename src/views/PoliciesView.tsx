import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Gavel,
  GitCompare,
  Layers,
  Mail,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sliders,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { NavigationBreadcrumbs } from '../components/NavigationBreadcrumbs';
import { ThemeSwitchControl } from '../components/ThemeSwitchControl';
import {
  inviteStaffUserByAdmin,
  resendInvitationEmailAdmin,
  saveNewPolicyVersion,
  updateOrganizationBranding,
  updateUserRoleAdmin,
} from '../services/axycoreStore';
import {
  ALL_CREDIT_PERMISSIONS,
  CREDIT_ROLE_PROFILES,
  PERMISSION_LABELS,
  ROLE_PERMISSION_MATRIX,
} from '../engine/rbac';
import {
  ROLE_LABELS,
  type CreditPolicyRecord,
  type NavSectionId,
  type ProductCode,
  type UserProfile,
  type UserRole,
  type UserStatus,
} from '../types/axycore';
import { WorkflowBuilder } from '../components/WorkflowBuilder';
import { syncRiskBandsWithAutoRejectThreshold } from '../engine/workflowBuilder';
import {
  buildDeterministicInvitationId,
  buildInvitationActivationUrl,
  deduplicateCorporateUsers,
  isPrimarySuperAdminEmail,
  normalizeEmailAddress,
} from '../engine/invitationFlow';
import { sanitizeIdSegment } from '../utils/formatters';

export type AdminFocusTab =
  | 'parameters'
  | 'risk_bands'
  | 'product_limits'
  | 'approval_matrix'
  | 'workflow'
  | 'users'
  | 'roles'
  | 'settings';

const POLICY_SUB_TABS: Array<{
  tab: AdminFocusTab;
  sectionId: NavSectionId;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    tab: 'parameters',
    sectionId: 'policies',
    label: 'Parámetros Generales',
    shortLabel: 'Generales y FX',
    description: 'Tipo de cambio DOP/USD, relación cuota/flujo y DTI máximo.',
    icon: Settings2,
  },
  {
    tab: 'risk_bands',
    sectionId: 'admin_risk_bands',
    label: 'Bandas de Riesgo y Tasas',
    shortLabel: 'Bandas y Tasas',
    description: 'Rangos de score, tasas mensuales y plazos máximos por banda.',
    icon: Sliders,
  },
  {
    tab: 'product_limits',
    sectionId: 'admin_product_limits',
    label: 'Límites de Productos',
    shortLabel: 'Límites',
    description: 'Montos mínimos, máximos y plazos para productos en DOP y USD.',
    icon: Layers,
  },
  {
    tab: 'approval_matrix',
    sectionId: 'admin_approval_matrix',
    label: 'Facultades de Aprobación',
    shortLabel: 'Facultades',
    description: 'Montos máximos por rol y reglas de aprobación colegiada.',
    icon: Gavel,
  },
  {
    tab: 'workflow',
    sectionId: 'admin_workflow',
    label: 'Flujo de Aprobación',
    shortLabel: 'Flujo (Workflow)',
    description: 'Etapas configurables y umbrales automáticos de decisión.',
    icon: GitCompare,
  },
];

const RBAC_DISPLAY_ROLES: UserRole[] = [
  'BUSINESS_OFFICER',
  'CREDIT_ANALYST',
  'RISK_OFFICER',
  'COMMITTEE_MEMBER',
  'FORMALIZATION',
  'OPERATIONS',
  'FINANCE',
  'COLLECTION_AGENT',
  'SUPERVISOR',
  'COLLECTION_COORDINATOR',
  'CASHIER',
  'MANAGEMENT',
  'AUDITOR',
  'ADMIN',
];

const SECTION_META: Record<
  AdminFocusTab,
  { breadcrumb: string; title: string; subtitle: string; isPolicySection: boolean }
> = {
  users: {
    breadcrumb: 'Administración / Usuarios',
    title: 'Usuarios y Aprovisionamiento Seguro',
    subtitle:
      'Invita colaboradores y administradores, asigna roles operativos y gestiona el estado de acceso dentro de la organización.',
    isPolicySection: false,
  },
  roles: {
    breadcrumb: 'Administración / Roles y Permisos',
    title: 'Roles y Segregación de Funciones (RBAC)',
    subtitle:
      'Consulta la matriz oficial de permisos operativos aplicados por rol en cada etapa del flujo crediticio y financiero.',
    isPolicySection: false,
  },
  parameters: {
    breadcrumb: 'Administración / Parámetros Crediticios',
    title: 'Parámetros Generales y Capacidad de Pago',
    subtitle:
      'Configura tipo de cambio de referencia, límites de cuota sobre flujo neto y DTI proyectado por versión de política.',
    isPolicySection: true,
  },
  risk_bands: {
    breadcrumb: 'Administración / Parámetros Crediticios / Bandas de Riesgo',
    title: 'Bandas de Riesgo, Tasas Mensuales y Plazos',
    subtitle:
      'Administra la matriz de tasas mensuales y plazos máximos asociados a cada banda del Motor de Decisiones.',
    isPolicySection: true,
  },
  product_limits: {
    breadcrumb: 'Administración / Parámetros Crediticios / Límites de Productos',
    title: 'Límites de Productos Crediticios (DOP / USD)',
    subtitle:
      'Define los montos mínimos, máximos y plazos habilitados para préstamos personales y empresariales.',
    isPolicySection: true,
  },
  approval_matrix: {
    breadcrumb: 'Administración / Parámetros Crediticios / Facultades de Aprobación',
    title: 'Matriz de Facultades de Aprobación',
    subtitle:
      'Controla los montos máximos autorizados por rol, productos cubiertos y requisitos de votación colegiada en Comité.',
    isPolicySection: true,
  },
  workflow: {
    breadcrumb: 'Administración / Parámetros Crediticios / Flujo de Aprobación',
    title: 'Constructor de Flujo de Aprobación y Umbrales',
    subtitle:
      'Organiza las etapas del expediente crediticio y sincroniza los umbrales de decisión automática con la política activa.',
    isPolicySection: true,
  },
  settings: {
    breadcrumb: 'Administración / Configuración Institucional',
    title: 'Configuración Institucional e Identidad',
    subtitle:
      'Actualiza el nombre oficial de la entidad, RNC/ID fiscal y la paleta de colores corporativos.',
    isPolicySection: false,
  },
};

export function PoliciesView({
  focusTab = 'parameters',
}: {
  focusTab?: AdminFocusTab;
} = {}) {
  const {
    policies,
    activeOrTestPolicy,
    userProfile,
    usersList,
    userInvitations,
    organization,
    rbac,
    setActiveSection,
  } = useAxyCore();

  const isAdmin = rbac.hasPermission('MANAGE_POLICIES_AND_RBAC');
  const displayUsers = useMemo(() => deduplicateCorporateUsers(usersList), [usersList]);
  const [selectedPolicyId, setSelectedPolicyId] = useState(activeOrTestPolicy.id);
  const [draft, setDraft] = useState<CreditPolicyRecord>(() =>
    JSON.parse(JSON.stringify(activeOrTestPolicy))
  );
  const [newVersionTag, setNewVersionTag] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Users section filters & invitation state
  const [userSearch, setUserSearch] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<'ALL' | UserStatus>('ALL');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('ADMIN');
  const [inviting, setInviting] = useState(false);
  const [resendingUid, setResendingUid] = useState<string | null>(null);
  const [latestInviteLink, setLatestInviteLink] = useState<{
    email: string;
    roleLabel: string;
    link: string;
    deliveryNote: string;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Roles RBAC search & focus filter
  const [rolePermissionSearch, setRolePermissionSearch] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<'ALL' | UserRole>('ALL');

  // Organization branding state
  const [orgName, setOrgName] = useState(organization.name);
  const [orgTaxId, setOrgTaxId] = useState(organization.taxId || '');
  const [primaryColor, setPrimaryColor] = useState(organization.primaryColor || '#0f3d91');
  const [accentColor, setAccentColor] = useState(organization.accentColor || '#0284c7');
  const [savingBranding, setSavingBranding] = useState(false);

  useEffect(() => {
    const found = policies.find((p) => p.id === selectedPolicyId) ?? activeOrTestPolicy;
    setDraft(JSON.parse(JSON.stringify(found)));
  }, [selectedPolicyId, policies, activeOrTestPolicy]);

  useEffect(() => {
    setOrgName(organization.name);
    setOrgTaxId(organization.taxId || '');
    setPrimaryColor(organization.primaryColor || '#0f3d91');
    setAccentColor(organization.accentColor || '#0284c7');
  }, [organization]);

  useEffect(() => {
    setFeedback(null);
  }, [focusTab]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return displayUsers.filter((u) => {
      if (userStatusFilter !== 'ALL' && u.status !== userStatusFilter) return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (ROLE_LABELS[u.role] || u.role).toLowerCase().includes(q)
      );
    });
  }, [displayUsers, userSearch, userStatusFilter]);

  const filteredPermissions = useMemo(() => {
    const q = rolePermissionSearch.trim().toLowerCase();
    if (!q) return ALL_CREDIT_PERMISSIONS;
    return ALL_CREDIT_PERMISSIONS.filter(
      (perm) =>
        PERMISSION_LABELS[perm].toLowerCase().includes(q) || perm.toLowerCase().includes(q)
    );
  }, [rolePermissionSearch]);

  const visibleRbacRoles = useMemo(
    () => (selectedRoleFilter === 'ALL' ? RBAC_DISPLAY_ROLES : [selectedRoleFilter]),
    [selectedRoleFilter]
  );

  const handleSavePolicy = async (asNewVersion: boolean) => {
    if (!userProfile || !isAdmin) return;
    setSaving(true);
    setFeedback(null);
    try {
      const targetVersion = asNewVersion
        ? newVersionTag.trim() || `v2.${policies.length + 1}.0-propuesta`
        : draft.version;
      const targetId = asNewVersion
        ? `pol_${sanitizeIdSegment(targetVersion.replace(/\./g, '_'))}_${Date.now().toString().slice(-4)}`
        : draft.id;

      const payload: CreditPolicyRecord = {
        ...draft,
        id: targetId,
        version: targetVersion,
        organizationId: userProfile.organizationId,
      };

      await saveNewPolicyVersion({
        policy: payload,
        adminUser: userProfile,
        isNewVersion: asNewVersion,
      });

      if (asNewVersion) {
        setSelectedPolicyId(targetId);
        setNewVersionTag('');
      }
      setFeedback({
        type: 'ok',
        msg: asNewVersion
          ? `Nueva versión de política ${targetVersion} creada sin alterar evaluaciones históricas.`
          : `Política ${targetVersion} (${draft.status}) actualizada correctamente.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error guardando política crediticia.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRoleUpdate = async (targetUid: string, role: UserRole, status: UserStatus) => {
    if (!userProfile || !isAdmin) return;
    try {
      await updateUserRoleAdmin({
        targetUid,
        role,
        status,
        adminUser: userProfile,
      });
      setFeedback({
        type: 'ok',
        msg: 'Rol y estado de usuario actualizados con registro en auditoría.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error actualizando usuario.',
      });
    }
  };

  const copyTextWithFeedback = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2500);
    } catch {
      // ignore clipboard restriction
    }
  };

  const getInvitationLinkForUser = (u: UserProfile): string => {
    const cleanEmail = normalizeEmailAddress(u.email);
    const matchedInv = userInvitations.find(
      (inv) => normalizeEmailAddress(inv.email) === cleanEmail
    );
    if (matchedInv?.invitationLink) return matchedInv.invitationLink;
    const origin =
      typeof window !== 'undefined' && window.location.origin
        ? window.location.origin
        : 'http://localhost:3000';
    return buildInvitationActivationUrl({
      origin,
      inviteId: buildDeterministicInvitationId(cleanEmail),
      orgCode: organization.accessCode || 'SGMA-001',
      email: cleanEmail,
    });
  };

  const handleResendInvitation = async (targetUser: UserProfile) => {
    if (!userProfile || !isAdmin) return;
    setResendingUid(targetUser.uid);
    setFeedback(null);
    try {
      const res = await resendInvitationEmailAdmin({
        targetUser,
        adminUser: userProfile,
        organization,
      });
      const deliveryNote =
        res.resetSent && res.smtpDelivered
          ? 'Correo enviado por Firebase Authentication y SMTP corporativo.'
          : res.resetSent
          ? 'Correo de configuración enviado por Firebase Authentication. También puedes compartir el enlace directo.'
          : res.smtpDelivered
          ? 'Correo de invitación entregado vía SMTP corporativo.'
          : 'Invitación activa en Firestore. Comparte el enlace directo o configura SMTP para envío automático.';
      setLatestInviteLink({
        email: targetUser.email,
        roleLabel: ROLE_LABELS[targetUser.role] || targetUser.role,
        link: res.invitationLink,
        deliveryNote,
      });
      setFeedback({
        type: 'ok',
        msg: `Invitación actualizada para ${targetUser.email} en ${organization.tradeName || organization.name}. ${deliveryNote}`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error reenviando correo de invitación.',
      });
    } finally {
      setResendingUid(null);
    }
  };

  const handleInviteStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !isAdmin) return;
    if (!inviteName.trim() || !inviteEmail.trim()) return;
    setInviting(true);
    setFeedback(null);
    try {
      const res = await inviteStaffUserByAdmin({
        email: inviteEmail.trim(),
        displayName: inviteName.trim(),
        role: inviteRole,
        adminUser: userProfile,
        organization,
      });
      const deliveryNote =
        res.resetSent && res.smtpDelivered
          ? 'Correo oficial de Firebase Auth y correo corporativo SMTP enviados.'
          : res.resetSent
          ? 'Correo de configuración de contraseña enviado por Firebase Auth. El usuario también puede usar el enlace directo con Google.'
          : res.smtpDelivered
          ? 'Correo de invitación enviado vía SMTP corporativo.'
          : 'Invitación verificable registrada en Firestore. El usuario puede entrar automáticamente abriendo el enlace de activación con Google.';

      setLatestInviteLink({
        email: res.profile.email,
        roleLabel: ROLE_LABELS[inviteRole],
        link: res.invitationLink,
        deliveryNote,
      });
      setFeedback({
        type: 'ok',
        msg: `Colaborador ${inviteName.trim()} (${res.profile.email}) invitado a ${organization.tradeName || organization.name} con rol ${ROLE_LABELS[inviteRole]}. ${deliveryNote}`,
      });
      setInviteName('');
      setInviteEmail('');
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'No fue posible aprovisionar el colaborador.',
      });
    } finally {
      setInviting(false);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !isAdmin) return;
    setSavingBranding(true);
    setFeedback(null);
    try {
      await updateOrganizationBranding({
        organizationId: organization.id,
        name: orgName.trim(),
        taxId: orgTaxId.trim(),
        primaryColor,
        accentColor,
        adminUser: userProfile,
      });
      setFeedback({
        type: 'ok',
        msg: 'Identidad institucional y colores corporativos actualizados.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error actualizando identidad.',
      });
    } finally {
      setSavingBranding(false);
    }
  };

  const productKeys: ProductCode[] = [
    'PERSONAL_DOP',
    'EMPRESARIAL_DOP',
    'PERSONAL_USD',
    'EMPRESARIAL_USD',
  ];

  const meta = SECTION_META[focusTab] ?? SECTION_META.parameters;

  const renderPolicyVersionToolbar = () => (
    <div className="axy-surface p-4 rounded-xl space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">
            Versión de Política:
          </label>
          <select
            value={selectedPolicyId}
            onChange={(e) => setSelectedPolicyId(e.target.value)}
            className="axy-input px-3 py-1.5 font-mono text-slate-900 dark:text-white"
          >
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.version} ({p.status})
              </option>
            ))}
          </select>

          <select
            disabled={!isAdmin || draft.status === 'HISTORICA'}
            value={draft.status}
            onChange={(e) =>
              setDraft({
                ...draft,
                status: e.target.value as CreditPolicyRecord['status'],
              })
            }
            className="axy-input px-3 py-1.5 font-semibold text-slate-900 dark:text-white disabled:opacity-60"
          >
            <option value="PROPUESTA">PROPUESTA</option>
            <option value="EN_PRUEBAS">EN_PRUEBAS</option>
            <option value="APROBADA">APROBADA</option>
            <option value="ACTIVA">ACTIVA</option>
            <option value="HISTORICA">HISTORICA</option>
          </select>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newVersionTag}
              onChange={(e) => setNewVersionTag(e.target.value)}
              placeholder="Nueva versión (ej. v2.1.0)"
              className="axy-input w-44 px-3 py-1.5 font-mono text-slate-900 dark:text-white"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSavePolicy(true)}
              className="axy-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Nueva Versión
            </button>
            {draft.status !== 'HISTORICA' && (
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSavePolicy(false)}
                className="axy-btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Guardando...' : `Guardar ${draft.version}`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Synchronized Policy Sub-section Segmented Control */}
      <div className="pt-3 border-t border-slate-200/80 dark:border-[#00B8FF]/15 flex flex-wrap items-center gap-1.5">
        {POLICY_SUB_TABS.filter((item) => rbac.canAccessSection(item.sectionId)).map((item) => {
          const Icon = item.icon;
          const active = focusTab === item.tab;
          return (
            <button
              key={item.tab}
              type="button"
              onClick={() => setActiveSection(item.sectionId)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-[#0066FF] text-white font-semibold shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.shortLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const activeUsersCount = displayUsers.filter((u) => u.status === 'ACTIVE').length;
  const invitedUsersCount = displayUsers.filter((u) => u.status === 'INVITED').length;

  return (
    <div className="space-y-5">
      {/* Clean Contextual Header & Live Synchronized Breadcrumbs */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <NavigationBreadcrumbs variant="inline" showSiblingSwitcher />
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            {meta.title}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-3xl">
            {meta.subtitle}
          </p>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 whitespace-nowrap">
          <span className="font-semibold text-slate-700 dark:text-slate-200">
            {organization.tradeName || organization.name}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{organization.accessCode || 'SGMA-001'}</span>
          <span aria-hidden="true">·</span>
          <span>Rol: {rbac.roleLabel}</span>
        </div>
      </div>

      {!isAdmin && meta.isPolicySection && (
        <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 text-xs">
          Vista de solo lectura. Solo el rol Administrador puede modificar parámetros, tasas, facultades de comité y flujo de aprobación.
        </div>
      )}

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      {/* =====================================================================
          1. PARÁMETROS GENERALES Y CAPACIDAD DE PAGO
         ===================================================================== */}
      {focusTab === 'parameters' && (
        <div className="space-y-5">
          {renderPolicyVersionToolbar()}

          <div className="axy-surface p-5 rounded-xl space-y-5 text-xs">
            <div className="pb-3 border-b border-slate-200/80 dark:border-[#00B8FF]/15">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                Tipo de Cambio y Límites de Capacidad de Pago
              </h3>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                Valores utilizados por el Motor de Decisiones Crediticias para evaluar solicitudes en DOP y USD.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block mb-1.5 font-medium text-slate-700 dark:text-slate-300">
                  Tipo de Cambio DOP / USD *
                </label>
                <input
                  type="number"
                  step="0.01"
                  disabled={!isAdmin || draft.status === 'HISTORICA'}
                  value={draft.exchangeRateConfig.dopPerUsd ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      exchangeRateConfig: {
                        ...draft.exchangeRateConfig,
                        dopPerUsd: e.target.value === '' ? null : Number(e.target.value),
                      },
                    })
                  }
                  placeholder="Ej. 60.50"
                  className="axy-input w-full px-3 py-2 font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block mb-1.5 font-medium text-slate-700 dark:text-slate-300">
                  Fecha / Fuente Tipo de Cambio
                </label>
                <input
                  disabled={!isAdmin || draft.status === 'HISTORICA'}
                  value={`${draft.exchangeRateConfig.rateDate} · ${draft.exchangeRateConfig.source}`}
                  onChange={(e) => {
                    const [rateDate, ...rest] = e.target.value.split('·');
                    setDraft({
                      ...draft,
                      exchangeRateConfig: {
                        ...draft.exchangeRateConfig,
                        rateDate: (rateDate || '').trim(),
                        source: rest.join('·').trim() || draft.exchangeRateConfig.source,
                      },
                    });
                  }}
                  className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block mb-1.5 font-medium text-slate-700 dark:text-slate-300">
                  Relación Máx. Cuota / Flujo (%)
                </label>
                <input
                  type="number"
                  step="1"
                  disabled={!isAdmin || draft.status === 'HISTORICA'}
                  value={Math.round(draft.capacityConfig.maxNewInstallmentRatio * 100)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      capacityConfig: {
                        ...draft.capacityConfig,
                        maxNewInstallmentRatio: Number(e.target.value) / 100,
                      },
                    })
                  }
                  className="axy-input w-full px-3 py-2 font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block mb-1.5 font-medium text-slate-700 dark:text-slate-300">
                  DTI Proyectado Máximo (%)
                </label>
                <input
                  type="number"
                  step="1"
                  disabled={!isAdmin || draft.status === 'HISTORICA'}
                  value={Math.round(draft.capacityConfig.maxProjectedDti * 100)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      capacityConfig: {
                        ...draft.capacityConfig,
                        maxProjectedDti: Number(e.target.value) / 100,
                      },
                    })
                  }
                  className="axy-input w-full px-3 py-2 font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Direct Navigation Shortcuts to the other Policy Submenus */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {POLICY_SUB_TABS.filter((t) => t.tab !== 'parameters' && rbac.canAccessSection(t.sectionId)).map(
              (item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.tab}
                    type="button"
                    onClick={() => setActiveSection(item.sectionId)}
                    className="axy-surface p-4 rounded-xl hover:border-[#0066FF]/50 dark:hover:border-[#00B8FF]/50 text-left space-y-2 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Icon className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                    <p className="font-display text-sm font-bold text-slate-900 dark:text-white">
                      {item.label}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {item.description}
                    </p>
                  </button>
                );
              }
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          2. BANDAS DE RIESGO Y TASAS
         ===================================================================== */}
      {focusTab === 'risk_bands' && (
        <div className="space-y-5">
          {renderPolicyVersionToolbar()}

          <div className="axy-surface rounded-xl overflow-hidden text-xs">
            <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-[#00B8FF]/15 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                Bandas de Riesgo, Tasas Mensuales y Plazos Máximos
              </h3>
              <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {draft.riskBands.length} bandas configuradas · {draft.version}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="axy-table-head">
                  <tr className="text-slate-600 dark:text-slate-300">
                    <th className="py-2.5 px-4 font-semibold">Banda de Riesgo</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Score Mínimo</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Score Máximo</th>
                    <th className="py-2.5 px-4 font-semibold">Tasa Mensual (%)</th>
                    <th className="py-2.5 px-4 font-semibold">Plazo Máximo (meses)</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {draft.riskBands.map((band, idx) => (
                    <tr key={band.code} className="axy-table-row">
                      <td className="py-2.5 px-4 font-sans font-semibold text-slate-900 dark:text-white">
                        {band.label}
                      </td>
                      <td className="py-2.5 px-4 text-right">{band.minScore}</td>
                      <td className="py-2.5 px-4 text-right">{band.maxScore}</td>
                      <td className="py-2.5 px-4">
                        {band.monthlyRate === null ? (
                          <span className="font-sans text-slate-500">Sin oferta automática</span>
                        ) : (
                          <input
                            type="number"
                            step="0.1"
                            disabled={!isAdmin || draft.status === 'HISTORICA'}
                            value={Number((band.monthlyRate * 100).toFixed(2))}
                            onChange={(e) => {
                              const updated = [...draft.riskBands];
                              updated[idx] = { ...band, monthlyRate: Number(e.target.value) / 100 };
                              setDraft({ ...draft, riskBands: updated });
                            }}
                            className="axy-input w-28 px-2.5 py-1.5 text-slate-900 dark:text-white"
                          />
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <input
                          type="number"
                          disabled={!isAdmin || draft.status === 'HISTORICA' || band.maxTermMonths === 0}
                          value={band.maxTermMonths}
                          onChange={(e) => {
                            const updated = [...draft.riskBands];
                            updated[idx] = { ...band, maxTermMonths: Number(e.target.value) };
                            setDraft({ ...draft, riskBands: updated });
                          }}
                          className="axy-input w-24 px-2.5 py-1.5 text-slate-900 dark:text-white"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          3. LÍMITES DE PRODUCTOS (DOP / USD)
         ===================================================================== */}
      {focusTab === 'product_limits' && (
        <div className="space-y-5">
          {renderPolicyVersionToolbar()}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {productKeys.map((pk) => {
              const p = draft.products[pk];
              if (!p) return null;
              return (
                <div
                  key={pk}
                  className="axy-surface p-5 rounded-xl space-y-4"
                >
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200/80 dark:border-[#00B8FF]/15">
                    <div>
                      <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                        {p.label}
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Código {pk} · Moneda {p.currency}
                      </p>
                    </div>
                    <span className="font-mono font-bold text-[#0066FF] dark:text-[#00D1FF]">
                      {p.currency}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 font-mono tabular-nums">
                    <div>
                      <label className="font-sans text-[11px] font-medium text-slate-500 dark:text-slate-400 block mb-1">
                        Monto Mínimo
                      </label>
                      <input
                        type="number"
                        disabled={!isAdmin || draft.status === 'HISTORICA'}
                        value={p.minAmount}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            products: {
                              ...draft.products,
                              [pk]: { ...p, minAmount: Number(e.target.value) },
                            },
                          })
                        }
                        className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="font-sans text-[11px] font-medium text-slate-500 dark:text-slate-400 block mb-1">
                        Monto Máximo
                      </label>
                      <input
                        type="number"
                        disabled={!isAdmin || draft.status === 'HISTORICA'}
                        value={p.maxAmount}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            products: {
                              ...draft.products,
                              [pk]: { ...p, maxAmount: Number(e.target.value) },
                            },
                          })
                        }
                        className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="font-sans text-[11px] font-medium text-slate-500 dark:text-slate-400 block mb-1">
                        Plazo Máx (meses)
                      </label>
                      <input
                        type="number"
                        disabled={!isAdmin || draft.status === 'HISTORICA'}
                        value={p.maxTermMonths}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            products: {
                              ...draft.products,
                              [pk]: { ...p, maxTermMonths: Number(e.target.value) },
                            },
                          })
                        }
                        className="axy-input w-full px-2.5 py-2 text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =====================================================================
          4. MATRIZ DE FACULTADES DE APROBACIÓN
         ===================================================================== */}
      {focusTab === 'approval_matrix' && (
        <div className="space-y-5">
          {renderPolicyVersionToolbar()}

          <div className="axy-surface rounded-xl overflow-hidden text-xs">
            <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-[#00B8FF]/15 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Matriz Configurable de Facultades de Aprobación
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Define topes de aprobación por rol, producto y quórum de aprobación colegiada.
                </p>
              </div>
              {isAdmin && draft.status !== 'HISTORICA' && (
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      approvalAuthorities: [
                        ...draft.approvalAuthorities,
                        {
                          id: `auth_${Date.now().toString().slice(-5)}`,
                          role: 'COMMITTEE_MEMBER',
                          productCode: 'ALL',
                          maxAmount: 500000,
                          allowedRiskBands: ['MUY_BAJO', 'BAJO', 'MODERADO'],
                          requiresCollegialApproval: false,
                          minVotesRequired: 1,
                          active: true,
                        },
                      ],
                    })
                  }
                  className="axy-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Agregar Facultad
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="axy-table-head">
                  <tr className="text-slate-600 dark:text-slate-300">
                    <th className="py-2.5 px-4 font-semibold">Rol</th>
                    <th className="py-2.5 px-4 font-semibold">Producto</th>
                    <th className="py-2.5 px-4 font-semibold">Monto Máx. Autorizado</th>
                    <th className="py-2.5 px-4 font-semibold text-center">Colegiado</th>
                    <th className="py-2.5 px-4 font-semibold text-center">Votos Mín.</th>
                    <th className="py-2.5 px-4 font-semibold text-center">Activo</th>
                    {isAdmin && draft.status !== 'HISTORICA' && (
                      <th className="py-2.5 px-4 font-semibold text-right">Quitar</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {draft.approvalAuthorities.length === 0 ? (
                    <tr>
                      <td
                        colSpan={isAdmin && draft.status !== 'HISTORICA' ? 7 : 6}
                        className="py-8 px-4 text-slate-500 text-center"
                      >
                        No hay límites de aprobación configurados aún. Use «Agregar Facultad» para definir facultades de Comité.
                      </td>
                    </tr>
                  ) : (
                    draft.approvalAuthorities.map((authRule, idx) => (
                      <tr key={authRule.id} className="axy-table-row">
                        <td className="py-2.5 px-4">
                          <select
                            disabled={!isAdmin || draft.status === 'HISTORICA'}
                            value={authRule.role}
                            onChange={(e) => {
                              const next = [...draft.approvalAuthorities];
                              next[idx] = { ...authRule, role: e.target.value as UserRole };
                              setDraft({ ...draft, approvalAuthorities: next });
                            }}
                            className="axy-input px-2.5 py-1.5 font-semibold text-slate-900 dark:text-white"
                          >
                            {(['COMMITTEE_MEMBER', 'RISK_OFFICER', 'MANAGEMENT', 'ADMIN'] as UserRole[]).map(
                              (r) => (
                                <option key={r} value={r}>
                                  {ROLE_LABELS[r]}
                                </option>
                              )
                            )}
                          </select>
                        </td>
                        <td className="py-2.5 px-4 font-mono">
                          <select
                            disabled={!isAdmin || draft.status === 'HISTORICA'}
                            value={authRule.productCode}
                            onChange={(e) => {
                              const next = [...draft.approvalAuthorities];
                              next[idx] = {
                                ...authRule,
                                productCode: e.target.value as ProductCode | 'ALL',
                              };
                              setDraft({ ...draft, approvalAuthorities: next });
                            }}
                            className="axy-input px-2.5 py-1.5 font-mono text-slate-900 dark:text-white"
                          >
                            <option value="ALL">ALL</option>
                            {productKeys.map((pk) => (
                              <option key={pk} value={pk}>
                                {pk}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums">
                          <input
                            type="number"
                            disabled={!isAdmin || draft.status === 'HISTORICA'}
                            value={authRule.maxAmount}
                            onChange={(e) => {
                              const next = [...draft.approvalAuthorities];
                              next[idx] = { ...authRule, maxAmount: Number(e.target.value) };
                              setDraft({ ...draft, approvalAuthorities: next });
                            }}
                            className="axy-input w-36 px-2.5 py-1.5 text-slate-900 dark:text-white"
                          />
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <input
                            type="checkbox"
                            disabled={!isAdmin || draft.status === 'HISTORICA'}
                            checked={authRule.requiresCollegialApproval}
                            onChange={(e) => {
                              const next = [...draft.approvalAuthorities];
                              next[idx] = { ...authRule, requiresCollegialApproval: e.target.checked };
                              setDraft({ ...draft, approvalAuthorities: next });
                            }}
                          />
                        </td>
                        <td className="py-2.5 px-4 text-center font-mono tabular-nums">
                          <input
                            type="number"
                            min={1}
                            max={10}
                            disabled={!isAdmin || draft.status === 'HISTORICA'}
                            value={authRule.minVotesRequired}
                            onChange={(e) => {
                              const next = [...draft.approvalAuthorities];
                              next[idx] = {
                                ...authRule,
                                minVotesRequired: Math.max(1, Number(e.target.value)),
                              };
                              setDraft({ ...draft, approvalAuthorities: next });
                            }}
                            className="axy-input w-16 px-2 py-1 text-center text-slate-900 dark:text-white"
                          />
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <input
                            type="checkbox"
                            disabled={!isAdmin || draft.status === 'HISTORICA'}
                            checked={authRule.active}
                            onChange={(e) => {
                              const next = [...draft.approvalAuthorities];
                              next[idx] = { ...authRule, active: e.target.checked };
                              setDraft({ ...draft, approvalAuthorities: next });
                            }}
                          />
                        </td>
                        {isAdmin && draft.status !== 'HISTORICA' && (
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  approvalAuthorities: draft.approvalAuthorities.filter(
                                    (item) => item.id !== authRule.id
                                  ),
                                })
                              }
                              aria-label="Eliminar regla de facultad"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          5. FLUJO DE APROBACIÓN (WORKFLOW BUILDER)
         ===================================================================== */}
      {focusTab === 'workflow' && (
        <div className="space-y-5">
          {renderPolicyVersionToolbar()}

          <div className="axy-surface p-5 rounded-xl text-xs">
            <WorkflowBuilder
              workflowConfig={draft.workflowConfig}
              dopPerUsd={draft.exchangeRateConfig.dopPerUsd ?? 60}
              capacityDtiRatio={draft.capacityConfig.maxProjectedDti}
              capacityMinCoverage={draft.capacityConfig.minCoverageRatio}
              canEdit={isAdmin && draft.status !== 'HISTORICA'}
              onChange={(nextWorkflow) =>
                setDraft((prev) => ({
                  ...prev,
                  workflowConfig: nextWorkflow,
                }))
              }
              onSyncCapacityFromWorkflow={({
                maxProjectedDti,
                minCoverageRatio,
                autoRejectMaxScore,
                syncCriticalBand,
              }) =>
                setDraft((prev) => ({
                  ...prev,
                  capacityConfig: {
                    ...prev.capacityConfig,
                    maxProjectedDti,
                    minCoverageRatio,
                  },
                  riskBands: syncCriticalBand
                    ? syncRiskBandsWithAutoRejectThreshold(prev.riskBands, autoRejectMaxScore)
                    : prev.riskBands,
                }))
              }
            />
          </div>
        </div>
      )}

      {/* =====================================================================
          6. USUARIOS Y APROVISIONAMIENTO SEGURO
         ===================================================================== */}
      {focusTab === 'users' && (
        <div className="space-y-5 text-xs">
          {!isAdmin ? (
            <div className="p-5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              Solo los administradores autorizados pueden invitar colaboradores y modificar roles o estados de usuario.
            </div>
          ) : (
            <>
              {/* Invite / Provision Form */}
              <form
                onSubmit={handleInviteStaff}
                className="axy-surface p-5 rounded-xl space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/80 dark:border-[#00B8FF]/15">
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <UserPlus className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                      Invitar / Aprovisionar Colaborador o Administrador
                    </h3>
                    <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                      Envía invitación por correo y genera enlace directo de activación e ingreso automático en{' '}
                      {organization.tradeName || organization.name}.
                    </p>
                  </div>
                  <div className="text-slate-500 dark:text-slate-400 flex items-center gap-2 font-mono tabular-nums">
                    <span>{displayUsers.length} usuarios</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-700 dark:text-emerald-400">{activeUsersCount} activos</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#0066FF] dark:text-[#00D1FF]">{invitedUsersCount} invitados</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-4">
                    <label className="block mb-1 font-medium text-slate-700 dark:text-slate-300">
                      Nombre completo *
                    </label>
                    <input
                      required
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      placeholder="Ej. María Pérez"
                      className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <label className="block mb-1 font-medium text-slate-700 dark:text-slate-300">
                      Correo electrónico *
                    </label>
                    <input
                      required
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="correo@empresa.com"
                      className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block mb-1 font-medium text-slate-700 dark:text-slate-300">
                      Rol asignado
                    </label>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as UserRole)}
                      className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                    >
                      {Object.entries(ROLE_LABELS)
                        .filter(([k]) => k !== 'EXTERNAL_CLIENT')
                        .map(([k, lbl]) => (
                          <option key={k} value={k}>
                            {lbl}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      disabled={inviting}
                      className="axy-btn-primary w-full px-4 py-2 whitespace-nowrap cursor-pointer disabled:opacity-50"
                    >
                      {inviting ? 'Enviando...' : 'Enviar Invitación'}
                    </button>
                  </div>
                </div>

                {latestInviteLink && (
                  <div className="axy-surface-ai p-3.5 rounded-lg space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-[#0066FF] dark:text-[#00D1FF] flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Enlace de Activación Automática — {latestInviteLink.email} ({latestInviteLink.roleLabel})
                      </p>
                      <button
                        type="button"
                        onClick={() => copyTextWithFeedback(latestInviteLink.link, 'latest_invite')}
                        className="axy-btn-primary inline-flex items-center gap-1 px-2.5 py-1 text-[11px] cursor-pointer"
                      >
                        {copiedKey === 'latest_invite' ? (
                          <>
                            <Check className="w-3 h-3" /> Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Copiar enlace
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">
                      {latestInviteLink.deliveryNote}
                    </p>
                    <div className="axy-surface-tonal px-2.5 py-1.5 rounded font-mono text-[10px] text-slate-700 dark:text-sky-200 break-all select-all">
                      {latestInviteLink.link}
                    </div>
                  </div>
                )}
              </form>

              {/* Users Directory Table */}
              <div className="axy-surface rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-[#00B8FF]/15 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                    Directorio de Usuarios ({filteredUsers.length})
                  </h3>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                      <input
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        placeholder="Buscar nombre, correo o rol..."
                        className="axy-input pl-8 pr-3 py-1.5 text-slate-900 dark:text-white"
                      />
                    </div>

                    <div className="axy-surface-tonal flex items-center gap-1 p-0.5 rounded-lg">
                      {(
                        [
                          { id: 'ALL', label: 'Todos' },
                          { id: 'ACTIVE', label: 'Activos' },
                          { id: 'INVITED', label: 'Invitados' },
                          { id: 'INACTIVE', label: 'Inactivos' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setUserStatusFilter(opt.id)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                            userStatusFilter === opt.id
                              ? 'bg-[#0066FF] text-white shadow-xs font-semibold'
                              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="axy-table-head">
                      <tr className="text-slate-600 dark:text-slate-300">
                        <th className="py-2.5 px-4 font-semibold">Usuario</th>
                        <th className="py-2.5 px-4 font-semibold">Rol</th>
                        <th className="py-2.5 px-4 font-semibold">Estado</th>
                        <th className="py-2.5 px-4 font-semibold">Invitación / Acceso</th>
                        <th className="py-2.5 px-4 font-semibold text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-500">
                            No se encontraron usuarios con los filtros aplicados.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((u) => {
                          const isPrimaryOwner =
                            isPrimarySuperAdminEmail(u.email) || Boolean(u.isSuperAdmin);
                          const userInviteLink = getInvitationLinkForUser(u);
                          const matchedInv = userInvitations.find(
                            (inv) => normalizeEmailAddress(inv.email) === normalizeEmailAddress(u.email)
                          );
                          const effectiveStatus =
                            matchedInv?.status === 'ACCEPTED'
                              ? 'CONFIRMADA'
                              : u.invitationStatus ||
                                (matchedInv?.status === 'INVITACION_ENVIADA'
                                  ? 'INVITACION_ENVIADA'
                                  : undefined);

                          return (
                            <tr
                              key={u.uid}
                              className="axy-table-row"
                            >
                              <td className="py-2.5 px-4">
                                <p className="font-semibold text-slate-900 dark:text-white">
                                  {u.displayName}
                                  {isPrimaryOwner && (
                                    <span className="ml-2 text-[11px] font-medium text-[#0066FF] dark:text-[#00D1FF]">
                                      · SuperAdmin
                                    </span>
                                  )}
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">{u.email}</p>
                              </td>
                              <td className="py-2.5 px-4">
                                <select
                                  value={isPrimaryOwner ? 'ADMIN' : u.role}
                                  disabled={isPrimaryOwner}
                                  onChange={(e) =>
                                    handleRoleUpdate(u.uid, e.target.value as UserRole, u.status)
                                  }
                                  className="axy-input px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-white disabled:opacity-70"
                                >
                                  {Object.entries(ROLE_LABELS).map(([k, lbl]) => (
                                    <option key={k} value={k}>
                                      {lbl}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-2.5 px-4">
                                <select
                                  value={u.status}
                                  disabled={isPrimaryOwner}
                                  onChange={(e) =>
                                    handleRoleUpdate(u.uid, u.role, e.target.value as UserStatus)
                                  }
                                  className="axy-input px-2.5 py-1.5 text-xs text-slate-900 dark:text-white disabled:opacity-70"
                                >
                                  <option value="ACTIVE">ACTIVO</option>
                                  <option value="INVITED">INVITADO</option>
                                  <option value="INACTIVE">INACTIVO</option>
                                </select>
                              </td>
                              <td className="py-2.5 px-4">
                                {effectiveStatus === 'INVITACION_ENVIADA' ? (
                                  <div className="space-y-0.5">
                                    <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                                      <Mail className="w-3.5 h-3.5" />
                                      Invitación enviada
                                    </span>
                                    {(u.invitedAt || matchedInv?.invitedAt) && (
                                      <p className="text-[11px] font-mono tabular-nums text-slate-400">
                                        {new Date(
                                          u.invitedAt || matchedInv?.invitedAt || ''
                                        ).toLocaleDateString()}
                                      </p>
                                    )}
                                  </div>
                                ) : effectiveStatus === 'CONFIRMADA' ? (
                                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#0066FF] dark:text-[#00D1FF]">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Acceso confirmado
                                  </span>
                                ) : (
                                  <span className="text-slate-500">Acceso directo</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  {!isPrimaryOwner && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        copyTextWithFeedback(userInviteLink, `copy_${u.uid}`)
                                      }
                                      className="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-[#0066FF] dark:text-slate-300 dark:hover:text-[#00D1FF] font-medium px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-white/[0.06] cursor-pointer"
                                      title="Copiar enlace directo de invitación y registro automático"
                                    >
                                      {copiedKey === `copy_${u.uid}` ? (
                                        <>
                                          <Check className="w-3 h-3 text-emerald-600" /> Copiado
                                        </>
                                      ) : (
                                        <>
                                          <Copy className="w-3 h-3" /> Enlace
                                        </>
                                      )}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={resendingUid === u.uid}
                                    onClick={() => handleResendInvitation(u)}
                                    className="inline-flex items-center gap-1 text-[11px] text-[#0066FF] hover:text-[#0052CC] dark:text-[#00D1FF] font-medium px-2 py-1 rounded hover:bg-[#0066FF]/10 dark:hover:bg-white/[0.06] cursor-pointer disabled:opacity-50"
                                    title="Reenviar correo de invitación"
                                  >
                                    <RefreshCw
                                      className={`w-3 h-3 ${resendingUid === u.uid ? 'animate-spin' : ''}`}
                                    />
                                    {resendingUid === u.uid ? 'Enviando...' : 'Reenviar'}
                                  </button>
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
        </div>
      )}

      {/* =====================================================================
          7. ROLES Y PERMISOS RBAC
         ===================================================================== */}
      {focusTab === 'roles' && (
        <div className="axy-surface rounded-xl overflow-hidden text-xs">
          <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-[#00B8FF]/15 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                Matriz RBAC de Segregación de Funciones ({filteredPermissions.length} permisos)
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Permisos operativos aplicados automáticamente por perfil de usuario en la plataforma.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  value={rolePermissionSearch}
                  onChange={(e) => setRolePermissionSearch(e.target.value)}
                  placeholder="Filtrar permiso..."
                  className="axy-input pl-8 pr-3 py-1.5 text-slate-900 dark:text-white"
                />
              </div>

              <select
                value={selectedRoleFilter}
                onChange={(e) => setSelectedRoleFilter(e.target.value as 'ALL' | UserRole)}
                className="axy-input px-2.5 py-1.5 text-slate-900 dark:text-white"
              >
                <option value="ALL">Todos los roles ({RBAC_DISPLAY_ROLES.length})</option>
                {RBAC_DISPLAY_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {CREDIT_ROLE_PROFILES[r].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="axy-table-head">
                <tr className="text-slate-600 dark:text-slate-300">
                  <th className="py-2.5 px-4 font-semibold sticky left-0 bg-[var(--axy-surface-tonal)] z-10 min-w-[220px]">
                    Permiso Operativo
                  </th>
                  {visibleRbacRoles.map((r) => (
                    <th key={r} className="py-2.5 px-2.5 text-center font-semibold whitespace-nowrap">
                      {CREDIT_ROLE_PROFILES[r].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredPermissions.map((perm) => (
                  <tr key={perm} className="axy-table-row">
                    <td className="py-2 px-4 font-medium text-slate-800 dark:text-slate-200 sticky left-0 bg-[var(--axy-surface)]">
                      {PERMISSION_LABELS[perm]}
                    </td>
                    {visibleRbacRoles.map((r) => {
                      const allowed = ROLE_PERMISSION_MATRIX[r][perm];
                      return (
                        <td
                          key={r}
                          className={`py-2 px-2.5 text-center font-mono tabular-nums ${
                            allowed
                              ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                              : 'text-slate-300 dark:text-slate-600'
                          }`}
                        >
                          {allowed ? 'SI' : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          8. CONFIGURACIÓN INSTITUCIONAL E IDENTIDAD
         ===================================================================== */}
      {focusTab === 'settings' && (
        <div className="space-y-5 text-xs">
          <ThemeSwitchControl variant="card" />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <form
              onSubmit={handleSaveBranding}
              className="axy-surface lg:col-span-7 p-5 rounded-xl space-y-4"
            >
              <div className="pb-3 border-b border-slate-200/80 dark:border-[#00B8FF]/15">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Palette className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                  Identidad Institucional y Colores Corporativos
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Estos datos se muestran en el portal corporativo, portal de clientes y documentos generados.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 font-medium text-slate-700 dark:text-slate-300">
                    Nombre de la Entidad *
                  </label>
                  <input
                    required
                    disabled={!isAdmin}
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block mb-1.5 font-medium text-slate-700 dark:text-slate-300">
                    RNC / ID Fiscal
                  </label>
                  <input
                    disabled={!isAdmin}
                    value={orgTaxId}
                    onChange={(e) => setOrgTaxId(e.target.value)}
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 font-medium text-slate-700 dark:text-slate-300">
                    Color Primario
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      disabled={!isAdmin}
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="h-10 w-14 rounded-lg border border-slate-200 dark:border-[#00B8FF]/20 cursor-pointer"
                    />
                    <input
                      type="text"
                      disabled={!isAdmin}
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="axy-input flex-1 px-3 py-2 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="block mb-1.5 font-medium text-slate-700 dark:text-slate-300">
                    Color Acento
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      disabled={!isAdmin}
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="h-10 w-14 rounded-lg border border-slate-200 dark:border-[#00B8FF]/20 cursor-pointer"
                    />
                    <input
                      type="text"
                      disabled={!isAdmin}
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="axy-input flex-1 px-3 py-2 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>
              </div>

            {isAdmin && (
              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={savingBranding}
                  className="axy-btn-primary inline-flex items-center gap-2 px-5 py-2 cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingBranding ? 'Guardando...' : 'Guardar Identidad Corporativa'}
                </button>
              </div>
            )}
          </form>

          {/* Live Organization Summary & Preview */}
          <div className="axy-surface lg:col-span-5 p-5 rounded-xl space-y-4 h-fit">
            <div className="pb-3 border-b border-slate-200/80 dark:border-[#00B8FF]/15 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                Ficha de Organización Activa
              </h3>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between py-1.5 border-b border-slate-200/60 dark:border-[#00B8FF]/10">
                <span className="text-slate-500 dark:text-slate-400">Entidad</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {orgName || organization.name}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-200/60 dark:border-[#00B8FF]/10">
                <span className="text-slate-500 dark:text-slate-400">RNC / ID Fiscal</span>
                <span className="font-mono text-slate-900 dark:text-white">
                  {orgTaxId || 'No registrado'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-200/60 dark:border-[#00B8FF]/10">
                <span className="text-slate-500 dark:text-slate-400">Código de Acceso</span>
                <span className="font-mono font-semibold text-[#0066FF] dark:text-[#00D1FF]">
                  {organization.accessCode || 'SGMA-001'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-200/60 dark:border-[#00B8FF]/10">
                <span className="text-slate-500 dark:text-slate-400">Plan Comercial</span>
                <span className="font-mono text-slate-900 dark:text-white">
                  {organization.planCode || 'CORPORATIVO'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-slate-500 dark:text-slate-400">Estado de Licencia</span>
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  {organization.licenseStatus || 'ACTIVA'}
                </span>
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Vista previa de paleta</p>
              <div className="grid grid-cols-2 gap-2">
                <div
                  className="h-10 rounded-lg flex items-center justify-center text-white font-mono text-[11px] font-semibold"
                  style={{ backgroundColor: primaryColor }}
                >
                  {primaryColor}
                </div>
                <div
                  className="h-10 rounded-lg flex items-center justify-center text-white font-mono text-[11px] font-semibold"
                  style={{ backgroundColor: accentColor }}
                >
                  {accentColor}
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
