import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PWAInstallButton } from './PWAInstallButton';
import { OfflineIndicator } from './OfflineIndicator';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  BarChart3,
  BookOpen,
  Bot,
  BrainCircuit,
  Briefcase,
  Calculator,
  CalendarClock,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Command,
  Compass,
  Cpu,
  CreditCard,
  FileCheck,
  FileMinus,
  FilePlus2,
  FileSignature,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Flame,
  FlaskConical,
  FolderOpen,
  Gavel,
  GitCompare,
  Globe,
  Handshake,
  Hash,
  Headphones,
  HelpCircle,
  Inbox,
  KeyRound,
  Landmark,
  Layers,
  LayoutDashboard,
  ListChecks,
  ListOrdered,
  Lock,
  LogOut,
  Menu,
  Moon,
  Network,
  Package,
  Percent,
  Radar,
  Receipt,
  Scale,
  ScanFace,
  Search,
  Send,
  Settings,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sun,
  TrendingUp,
  UserCheck,
  UserCog,
  Users,
  UserX,
  Wallet,
  X,
} from 'lucide-react';
import { NavSectionId, useAxyCore } from '../context/AxyCoreContext';
import { isValidInstitutionalLogoUrl } from '../utils/institutionalLogo';
import { CreditNotificationToasts } from './CreditNotifications';
import {
  NotificationCenter,
  triggerOpenNotificationCenter,
} from './NotificationCenter';
import { NavigationBreadcrumbs } from './NavigationBreadcrumbs';
import { BelaFloatingWidget } from './BelaAssistant';
import { ThemeSwitchControl } from './ThemeSwitchControl';
import { UserSettingsModal } from './UserSettingsModal';
import {
  buildCobrosDelDiaQueue,
  buildCobrosLegalQueue,
  buildCobrosUrgentesQueue,
} from '../engine/collections/priorityAndTasksEngine';
import { classifyAgreementsForManagement } from '../engine/collections/promisesAndActionsEngine';
import { APPLICATION_STATUS_LABELS, formatMoney } from '../utils/formatters';

interface NavItem {
  id: NavSectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  comingSoon?: boolean;
  secondary?: boolean;
  subItemOf?: NavSectionId;
}

interface NavGroupDefinition {
  key: 'inicio' | 'prestamos' | 'clientes' | 'cartera' | 'contact_center' | 'operaciones' | 'reportes' | 'inteligencia' | 'administracion';
  title: string;
  items: NavItem[];
}

const SIDEBAR_GROUPS: NavGroupDefinition[] = [
  {
    key: 'inicio',
    title: 'INICIO',
    items: [
      { id: 'platform_control', label: 'AxyCore Platform Control', icon: ShieldCheck },
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'system_guide', label: 'Guía de AxyCore', icon: BookOpen },
    ],
  },
  {
    key: 'prestamos',
    title: 'PRÉSTAMOS',
    items: [
      { id: 'new_application', label: 'Nueva Solicitud', icon: FilePlus2 },
      { id: 'loan_calculator', label: 'Calculadora de Préstamos', icon: Calculator },
      { id: 'applications', label: 'Solicitudes Recibidas', icon: Inbox },
      { id: 'decision_engine', label: 'Motor de Decisiones', icon: Cpu },
      { id: 'evaluation', label: 'Evaluación', icon: CheckSquare },
      { id: 'committee', label: 'Comité', icon: Gavel },
      { id: 'formalization', label: 'Formalización', icon: FileSignature },
      { id: 'disbursements', label: 'Desembolso', icon: Send },
      { id: 'loans', label: 'Activos', icon: Landmark },
      { id: 'credit_dashboard', label: 'Mapa de Riesgo y Originación', icon: Layers },
    ],
  },
  {
    key: 'clientes',
    title: 'CLIENTES',
    items: [
      { id: 'customers', label: 'Todos los Clientes', icon: Users },
      { id: 'customers_active', label: 'Activos', icon: UserCheck, subItemOf: 'customers' },
      { id: 'customers_inactive', label: 'Inactivos', icon: UserX, subItemOf: 'customers' },
      { id: 'customers_update', label: 'Actualizar Datos de Clientes', icon: UserCog },
      { id: 'documents', label: 'Expedientes Digitales', icon: FolderOpen },
    ],
  },
  {
    key: 'cartera',
    title: 'COBROS',
    items: [
      { id: 'cobranza_portfolio', label: 'Clientes en Cobros', icon: Wallet },
      { id: 'cobranza_daily', label: 'Cobros del día', icon: ClipboardCheck },
      { id: 'cobranza_urgent', label: 'Cobros Urgentes', icon: Flame },
      { id: 'cobranza_legal', label: 'Cobros en Legal', icon: Gavel },
      { id: 'cobranza_discounts', label: 'Descuentos', icon: Percent },
      {
        id: 'cobranza_discounts_mora',
        label: 'Mora',
        icon: Percent,
        subItemOf: 'cobranza_discounts',
      },
      {
        id: 'cobranza_discounts_payoff',
        label: 'Saldos',
        icon: Receipt,
        subItemOf: 'cobranza_discounts',
      },
      { id: 'cobranza_actions', label: 'Gestiones de Cobros', icon: ListChecks },
      {
        id: 'cobranza_agreements_today',
        label: 'Acuerdos del día',
        icon: Handshake,
        subItemOf: 'cobranza_actions',
      },
      {
        id: 'cobranza_agreements_broken',
        label: 'Acuerdos Incumplidos',
        icon: AlertTriangle,
        subItemOf: 'cobranza_actions',
      },
      { id: 'cobranza_dashboard', label: 'Panel de Cobranza', icon: Activity, secondary: true },
      { id: 'cobranza_promises', label: 'Todos los Acuerdos y Promesas', icon: Handshake, secondary: true },
      { id: 'cobranza_payments', label: 'Pagos', icon: CreditCard, secondary: true },
      { id: 'cobranza_bot', label: 'AxyRecovery Bot', icon: Bot, secondary: true },
      { id: 'cobranza_my_actions', label: 'Mis Gestiones', icon: UserCheck, secondary: true },
      { id: 'cobranza_agenda', label: 'Agenda de Seguimiento', icon: CalendarClock, secondary: true },
      { id: 'cobranza_unidentified', label: 'Pagos por Identificar', icon: HelpCircle, secondary: true },
      { id: 'cobranza_audit', label: 'Auditoría y Cierre Cobranza', icon: ShieldCheck, secondary: true },
    ],
  },
  {
    key: 'contact_center',
    title: 'CONTACT CENTER',
    items: [
      { id: 'cobranza_contact_center', label: 'Contact Center KPIs', icon: Headphones },
    ],
  },
  {
    key: 'operaciones',
    title: 'OPERACIONES GENERALES',
    items: [
      { id: 'accounting', label: 'Panel de Contabilidad', icon: BookOpen },
      { id: 'accounting_chart_of_accounts', label: 'Plan de Cuentas', icon: ListOrdered, subItemOf: 'accounting' },
      { id: 'accounting_journal_entries', label: 'Asientos Contables', icon: FileText, subItemOf: 'accounting' },
      { id: 'accounting_daily_book', label: 'Libro Diario', icon: BookOpen, subItemOf: 'accounting' },
      { id: 'accounting_general_ledger', label: 'Libro Mayor', icon: Scale, subItemOf: 'accounting' },
      { id: 'accounting_receivables', label: 'Cuentas por Cobrar', icon: ArrowDownLeft, subItemOf: 'accounting' },
      { id: 'accounting_payables', label: 'Cuentas por Pagar', icon: ArrowUpRight, subItemOf: 'accounting' },
      { id: 'accounting_taxes', label: 'Impuestos', icon: Hash, subItemOf: 'accounting' },
      {
        id: 'accounting_payment_validation',
        label: 'Pagos para Validar',
        icon: ClipboardCheck,
        subItemOf: 'accounting',
      },
      {
        id: 'cobranza_reconciliation',
        label: 'Conciliación Bancaria',
        icon: GitCompare,
        subItemOf: 'accounting',
      },
      {
        id: 'ecf_dashboard',
        label: 'Facturación Electrónica DGII',
        icon: Receipt,
        subItemOf: 'accounting',
      },
      { id: 'ecf_emit', label: 'Emitir Factura Electrónica', icon: FilePlus2, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_issued', label: 'Facturas Emitidas', icon: FileCheck, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_received', label: 'Facturas Recibidas', icon: Inbox, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_credit_notes', label: 'Notas de Crédito', icon: FileMinus, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_debit_notes', label: 'Notas de Débito', icon: FileText, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_dgii_status', label: 'Consulta de Estado DGII', icon: Search, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_void', label: 'Anulaciones', icon: Ban, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_customers', label: 'Clientes y Receptores', icon: Users, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_products', label: 'Productos y Servicios', icon: Package, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_sequences', label: 'Secuencias e-NCF', icon: Hash, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_certificates', label: 'Certificados Digitales', icon: KeyRound, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_config', label: 'Configuración DGII', icon: Settings2, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_sandbox', label: 'Ambiente de Pruebas', icon: FlaskConical, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_reports', label: 'Reportes Fiscales', icon: BarChart3, subItemOf: 'ecf_dashboard' },
      { id: 'ecf_audit', label: 'Auditoría y Trazabilidad', icon: ShieldAlert, subItemOf: 'ecf_dashboard' },
      {
        id: 'accounting_statements',
        label: 'Reportes Contables',
        icon: FileSpreadsheet,
        subItemOf: 'accounting',
      },
      { id: 'register_payment', label: 'Registrar Pagos', icon: CreditCard },
      { id: 'register_expense', label: 'Registrar Gastos', icon: Receipt },
      { id: 'register_investor', label: 'Registrar Inversionistas', icon: Briefcase },
    ],
  },
  {
    key: 'reportes',
    title: 'REPORTES',
    items: [
      { id: 'reports', label: 'Reportes y Analítica', icon: BarChart3 },
      { id: 'cobranza_reports', label: 'Reportes de Cobranza', icon: FileSpreadsheet },
    ],
  },
  {
    key: 'inteligencia',
    title: 'INTELIGENCIA Y CONTROL INSTITUCIONAL',
    items: [
      { id: 'director', label: 'AxyCore Director', icon: BrainCircuit },
      { id: 'intelligence_dashboard', label: 'Inteligencia de Motor', icon: Cpu },
      { id: 'intelligence_altera', label: 'Altera', icon: Compass },
      { id: 'cobranza_sentinel', label: 'Centinela', icon: Radar },
      { id: 'cobranza_anticipate', label: 'Anticípate', icon: TrendingUp },
      { id: 'regula', label: 'REGULA', icon: ShieldCheck },
      { id: 'system_sitemap', label: 'Mapa del Sistema', icon: Network },
      { id: 'intelligence_impulsa', label: 'Impulsa', icon: Activity },
    ],
  },
  {
    key: 'administracion',
    title: 'ADMINISTRACIÓN',
    items: [
      { id: 'admin_users', label: 'Usuarios', icon: Users },
      { id: 'admin_roles', label: 'Roles y Permisos', icon: ShieldCheck },
      { id: 'policies', label: 'Parámetros Crediticios', icon: Settings2 },
      {
        id: 'admin_risk_bands',
        label: 'Bandas de Riesgo y Tasas',
        icon: Sliders,
        subItemOf: 'policies',
      },
      {
        id: 'admin_product_limits',
        label: 'Límites de Productos',
        icon: Layers,
        subItemOf: 'policies',
      },
      {
        id: 'admin_approval_matrix',
        label: 'Facultades de Aprobación',
        icon: Gavel,
        subItemOf: 'policies',
      },
      {
        id: 'admin_workflow',
        label: 'Flujo de Aprobación',
        icon: GitCompare,
        subItemOf: 'policies',
      },
      { id: 'cobranza_assignment', label: 'Asignación de Cartera', icon: Users },
      { id: 'cobranza_params', label: 'Parámetros de Cobranza', icon: Sliders },
      { id: 'admin_settings', label: 'Configuración Institucional', icon: Settings },
      { id: 'audit', label: 'Auditoría', icon: ShieldAlert },
    ],
  },
];

interface PaletteResult {
  key: string;
  group: 'Módulo' | 'Cliente' | 'Documento' | 'Solicitud' | 'Préstamo 360°' | 'Pago';
  title: string;
  subtitle: string;
  onSelect: () => void;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    firebaseUser,
    userProfile,
    organization,
    activeSection,
    setActiveSection,
    darkMode,
    toggleDarkMode,
    logout,
    externalPortalMode,
    setExternalPortalMode,
    unreadAlertCount,
    customers,
    businesses,
    documents,
    applications,
    loans,
    collectionAccounts,
    riskAlerts,
    reconciliationExceptions,
    paymentPromises,
    paymentAgreements,
    payments,
    operatingExpenses,
    dgiiEcfDocuments,
    setSelectedApplicationId,
    setSelectedCollectionLoanId,
    rbac,
    isSuperAdmin,
    isPlatformAdminPortal,
    portalMode,
    switchPortalMode,
    availableWorkspaces,
    switchOrganizationWorkspace,
    biometricSupported,
    biometricLabel,
    biometricEnrolled,
    enrollBiometrics,
    lockWithBiometrics,
    disableBiometrics,
  } = useAxyCore();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('axycore_sidebar_collapsed') === 'true';
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    inicio: true,
    prestamos: false,
    clientes: false,
    cartera: false,
    contact_center: false,
    operaciones: false,
    reportes: false,
    inteligencia: false,
    administracion: false,
  });
  const [showAllSecondary, setShowAllSecondary] = useState<Record<string, boolean>>({
    prestamos: false,
    cartera: false,
  });
  const [openSubMenus, setOpenSubMenus] = useState<Record<string, boolean>>({
    policies: false,
    customers: false,
    accounting: false,
    ecf_dashboard: false,
    cobranza_discounts: false,
    cobranza_actions: false,
  });

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const paletteInputRef = useRef<HTMLInputElement>(null);

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [orgLogoFailed, setOrgLogoFailed] = useState(false);
  const [bioFeedback, setBioFeedback] = useState<string | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOrgLogoFailed(false);
  }, [organization.logoUrl]);

  const hasInstitutionalLogo =
    isValidInstitutionalLogoUrl(organization.logoUrl) && !orgLogoFailed;

  const isExternalClient = rbac.role === 'EXTERNAL_CLIENT';
  const canOriginate = rbac.hasPermission('ORIGINATE_APPLICATION');

  // Auto-expand the sidebar group (and any ancestor submenus) containing the active section
  useEffect(() => {
    const targetGroup = SIDEBAR_GROUPS.find((g) =>
      g.items.some((item) => item.id === activeSection)
    );
    if (!targetGroup) return;
    setOpenGroups((prev) => (prev[targetGroup.key] ? prev : { ...prev, [targetGroup.key]: true }));

    const activeItem = targetGroup.items.find((i) => i.id === activeSection);
    if (activeItem?.subItemOf) {
      const ancestors: NavSectionId[] = [];
      let cursor: NavSectionId | undefined = activeItem.subItemOf;
      let guard = 0;
      while (cursor && guard < 4) {
        ancestors.push(cursor);
        cursor = targetGroup.items.find((i) => i.id === cursor)?.subItemOf;
        guard += 1;
      }
      if (ancestors.length > 0) {
        setOpenSubMenus((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const anc of ancestors) {
            if (!next[anc]) {
              next[anc] = true;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
    }
  }, [activeSection]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('axycore_sidebar_collapsed', String(next));
      }
      return next;
    });
  };

  useEffect(() => {
    if (!profileMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [profileMenuOpen]);

  useEffect(() => {
    if (externalPortalMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if (e.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [externalPortalMode, paletteOpen]);

  useEffect(() => {
    if (paletteOpen) {
      setPaletteQuery('');
      setPaletteIndex(0);
      const id = window.setTimeout(() => paletteInputRef.current?.focus(), 20);
      return () => window.clearTimeout(id);
    }
  }, [paletteOpen]);

  const collectorFilterId =
    rbac.role === 'COLLECTION_AGENT' ? userProfile?.uid ?? null : null;

  const dailyTramoCount = useMemo(
    () =>
      buildCobrosDelDiaQueue({
        accounts: collectionAccounts,
        promises: paymentPromises,
        alerts: riskAlerts,
        collectorId: collectorFilterId,
      }).length,
    [collectionAccounts, paymentPromises, riskAlerts, collectorFilterId]
  );

  const urgentTramoCount = useMemo(
    () =>
      buildCobrosUrgentesQueue({
        accounts: collectionAccounts,
        promises: paymentPromises,
        alerts: riskAlerts,
        collectorId: collectorFilterId,
      }).length,
    [collectionAccounts, paymentPromises, riskAlerts, collectorFilterId]
  );

  const legalTramoCount = useMemo(
    () =>
      buildCobrosLegalQueue({
        accounts: collectionAccounts,
        promises: paymentPromises,
        alerts: riskAlerts,
        collectorId: collectorFilterId,
      }).length,
    [collectionAccounts, paymentPromises, riskAlerts, collectorFilterId]
  );

  const agreementMgmtClassification = useMemo(
    () =>
      classifyAgreementsForManagement({
        agreements: paymentAgreements,
        accounts: collectionAccounts,
        payments,
        collectorId: collectorFilterId,
      }),
    [paymentAgreements, collectionAccounts, payments, collectorFilterId]
  );

  const agreementsTodayCount = agreementMgmtClassification.acuerdosDelDia.length;
  const agreementsBrokenCount = agreementMgmtClassification.acuerdosIncumplidos.length;
  const lateFeeAccountsCount = collectionAccounts.filter(
    (a) =>
      !a.lateFeeExempt &&
      a.stage !== 'CANCELADO' &&
      (a.overdueLateFee ?? 0) > 0
  ).length;

  const activeAlertsCount = riskAlerts.filter((a) => a.status === 'ACTIVA').length;
  const openExceptionsCount = reconciliationExceptions.filter((e) => e.status === 'ABIERTA').length;
  const pendingPaymentsCount = payments.filter((p) =>
    ['REPORTADO', 'RECIBIDO_PENDIENTE_VERIFICACION', 'VERIFICADO'].includes(p.status)
  ).length;
  const pendingExpensesCount = operatingExpenses.filter((e) => e.status === 'PENDIENTE').length;
  const pendingCommitteeCount = applications.filter((a) => a.status === 'EN_COMITE').length;
  const brokenPromisesCount = paymentPromises.filter((p) => p.status === 'INCUMPLIDA').length;

  const visibleGroups = useMemo(() => {
    return SIDEBAR_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (item.id !== 'platform_control' || isPlatformAdminPortal) &&
          rbac.canAccessSection(item.id)
      ),
    })).filter((g) => g.items.length > 0);
  }, [rbac, isPlatformAdminPortal]);

  const permittedNavItems = useMemo(
    () => visibleGroups.flatMap((g) => g.items),
    [visibleGroups]
  );

  const handleSelectNav = (id: NavSectionId) => {
    setActiveSection(id);
    if (
      id === 'ecf_dashboard' ||
      id === 'accounting' ||
      id === 'policies' ||
      id === 'customers' ||
      id === 'cobranza_discounts'
    ) {
      setOpenSubMenus((prev) => ({ ...prev, [id]: true }));
    }
    setMobileOpen(false);
  };

  // Global Search Results across Clientes, Documentos, Préstamos, Solicitudes, Pagos, Módulos (RBAC filtered)
  const paletteResults = useMemo<PaletteResult[]>(() => {
    const q = paletteQuery.trim().toLowerCase();
    const results: PaletteResult[] = [];

    // 1. Módulos autorizados
    permittedNavItems.forEach((mod) => {
      if (!q || mod.label.toLowerCase().includes(q)) {
        results.push({
          key: `mod_${mod.id}`,
          group: 'Módulo',
          title: mod.label,
          subtitle: mod.comingSoon ? 'Vista informativa · Próximamente' : 'Ir al módulo autorizado',
          onSelect: () => {
            setActiveSection(mod.id);
            setPaletteOpen(false);
          },
        });
      }
    });

    // 2. Clientes y Empresas (Nombre, Cédula, RNC, Teléfono)
    if (rbac.canAccessSection('customers') && (q.length > 0 || results.length < 8)) {
      const matchedCusts = customers
        .filter((c) => {
          if (!q) return false;
          const fullName = `${c.firstName} ${c.lastName}`.toLowerCase();
          return (
            fullName.includes(q) ||
            (c.documentNumber || '').toLowerCase().includes(q) ||
            (c.phone || '').toLowerCase().includes(q) ||
            (c.email || '').toLowerCase().includes(q)
          );
        })
        .slice(0, 4);

      matchedCusts.forEach((c) => {
        results.push({
          key: `cust_${c.id}`,
          group: 'Cliente',
          title: `${c.firstName} ${c.lastName}`,
          subtitle: `${c.documentType}: ${c.documentNumber} · Tel: ${c.phone || '—'}`,
          onSelect: () => {
            setActiveSection('customers');
            setPaletteOpen(false);
          },
        });
      });

      const matchedBiz = businesses
        .filter((b) => {
          if (!q) return false;
          return (
            b.legalName.toLowerCase().includes(q) ||
            (b.tradeName || '').toLowerCase().includes(q) ||
            (b.rnc || '').toLowerCase().includes(q)
          );
        })
        .slice(0, 3);

      matchedBiz.forEach((b) => {
        results.push({
          key: `biz_${b.id}`,
          group: 'Cliente',
          title: b.legalName,
          subtitle: `RNC: ${b.rnc} · ${b.economicActivity || 'Empresa'}`,
          onSelect: () => {
            setActiveSection('customers');
            setPaletteOpen(false);
          },
        });
      });
    }

    // 3. Solicitudes Recibidas
    if (rbac.canAccessSection('applications') && (q.length > 0 || results.length < 12)) {
      const appMatches = applications
        .filter((a) => {
          if (!q) return true;
          return (
            a.applicationNumber.toLowerCase().includes(q) ||
            a.applicantDisplayName.toLowerCase().includes(q) ||
            a.fileNumber.toLowerCase().includes(q)
          );
        })
        .slice(0, 5);

      appMatches.forEach((app) => {
        results.push({
          key: `app_${app.id}`,
          group: 'Solicitud',
          title: `${app.applicationNumber} · ${app.applicantDisplayName}`,
          subtitle: `${APPLICATION_STATUS_LABELS[app.status]} · ${formatMoney(app.requestedAmount, app.currency)}`,
          onSelect: () => {
            setActiveSection('applications');
            setSelectedApplicationId(app.id);
            setPaletteOpen(false);
          },
        });
      });
    }

    // 4. Préstamos 360°
    if (
      (rbac.hasPermission('VIEW_COLLECTIONS_PORTFOLIO') || rbac.canAccessSection('loans')) &&
      (q.length > 0 || results.length < 16)
    ) {
      const loanMatches = loans
        .filter((l) => {
          if (!q) return true;
          return (
            l.loanNumber.toLowerCase().includes(q) ||
            l.applicantDisplayName.toLowerCase().includes(q)
          );
        })
        .slice(0, 5);

      loanMatches.forEach((loan) => {
        const acc = collectionAccounts.find((c) => c.loanId === loan.id);
        results.push({
          key: `loan_${loan.id}`,
          group: 'Préstamo 360°',
          title: `${loan.loanNumber} · ${loan.applicantDisplayName}`,
          subtitle: `Saldo ${formatMoney(loan.currentPrincipalBalance, loan.currency)} · ${
            acc ? `${acc.dpd} DPD (${acc.stage})` : loan.status
          }`,
          onSelect: () => {
            if (rbac.hasPermission('VIEW_COLLECTIONS_PORTFOLIO')) {
              setSelectedCollectionLoanId(loan.id);
            } else {
              setActiveSection('loans');
            }
            setPaletteOpen(false);
          },
        });
      });
    }

    // 5. Pagos (Referencia, Préstamo, Cliente)
    if (rbac.canAccessSection('cobranza_payments') && q.length > 0) {
      const payMatches = payments
        .filter((p) => {
          return (
            (p.referenceNumber || '').toLowerCase().includes(q) ||
            (p.loanNumber || '').toLowerCase().includes(q) ||
            (p.customerName || '').toLowerCase().includes(q)
          );
        })
        .slice(0, 4);

      payMatches.forEach((p) => {
        results.push({
          key: `pay_${p.id}`,
          group: 'Pago',
          title: `Ref. ${p.referenceNumber || p.id.slice(0, 8)} · ${formatMoney(p.amount, p.currency)}`,
          subtitle: `${p.loanNumber} · ${p.status} · ${p.paymentDate}`,
          onSelect: () => {
            setActiveSection('cobranza_payments');
            setPaletteOpen(false);
          },
        });
      });
    }

    // 6. Documentos / Expedientes
    if (rbac.canAccessSection('documents') && q.length > 0) {
      const docMatches = documents
        .filter((d) => {
          return (
            d.fileName.toLowerCase().includes(q) ||
            d.category.toLowerCase().includes(q) ||
            d.applicationId.toLowerCase().includes(q)
          );
        })
        .slice(0, 4);

      docMatches.forEach((d) => {
        results.push({
          key: `doc_${d.id}`,
          group: 'Documento',
          title: `${d.fileName}`,
          subtitle: `${d.category} · Estado: ${d.reviewStatus}`,
          onSelect: () => {
            setActiveSection('documents');
            setPaletteOpen(false);
          },
        });
      });
    }

    return results.slice(0, 18);
  }, [
    paletteQuery,
    permittedNavItems,
    customers,
    businesses,
    applications,
    loans,
    collectionAccounts,
    payments,
    documents,
    rbac,
    setActiveSection,
    setSelectedApplicationId,
    setSelectedCollectionLoanId,
  ]);

  useEffect(() => {
    setPaletteIndex(0);
  }, [paletteQuery]);

  if (externalPortalMode) {
    return (
      <div className="min-h-screen bg-[#f4f7fc] dark:bg-[#030816] text-slate-950 dark:text-slate-100 flex flex-col">
        <header className="sticky top-0 z-30 h-16 bg-white/88 dark:bg-[#050E24]/88 backdrop-blur-xl border-b border-slate-200/80 dark:border-[#00B8FF]/15 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
            <div className="h-8 w-8 rounded-lg bg-white p-1 ring-1 ring-[#00B8FF]/30 shadow-xs flex items-center justify-center">
              <img
                src="/assets/aistudio/image_aea21874.png"
                alt="AxyCore"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
              />
            </div>
            <span className="font-display text-lg font-extrabold tracking-tight">
              Axy<span className="axy-wordmark-core">Core</span>
            </span>
          </div>

          <div className="hidden md:flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 truncate">
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              Portal de Clientes
            </span>
            <span aria-hidden="true">·</span>
            <span>{organization.tradeName || organization.name}</span>
            <span aria-hidden="true">·</span>
            <span>{userProfile?.displayName}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <NotificationCenter />
            {activeSection === 'new_application' && (
              <button
                type="button"
                onClick={() => setActiveSection('loans')}
                className="px-3 py-1.5 rounded-lg border border-[#00B8FF]/30 bg-[#0066FF]/10 text-[#0052CC] dark:text-[#00D1FF] text-xs font-semibold hover:bg-[#0066FF]/20 whitespace-nowrap cursor-pointer"
              >
                Mis Préstamos y Cuotas
              </button>
            )}
            {biometricSupported && (
              <button
                type="button"
                onClick={() => {
                  if (biometricEnrolled) {
                    lockWithBiometrics();
                  } else {
                    void enrollBiometrics();
                  }
                }}
                title={
                  biometricEnrolled
                    ? `Bloquear sesión con ${biometricLabel}`
                    : `Activar ${biometricLabel}`
                }
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#00B8FF]/20 text-xs font-medium hover:bg-slate-100 dark:hover:bg-white/5 whitespace-nowrap cursor-pointer"
              >
                <ScanFace className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
                <span>{biometricEnrolled ? 'Bloquear' : biometricLabel}</span>
              </button>
            )}
            {isSuperAdmin ? (
              <>
                <button
                  type="button"
                  onClick={() => void switchPortalMode('corporate', 'org_axycore_main')}
                  className="px-3 py-1.5 rounded-lg border border-[#00B8FF]/30 bg-[#0066FF]/10 text-[#0052CC] dark:text-[#00D1FF] text-xs font-semibold hover:bg-[#0066FF]/20 whitespace-nowrap cursor-pointer"
                >
                  Portal Corporativo
                </button>
                <button
                  type="button"
                  onClick={() => void switchPortalMode('axycore_admin')}
                  className="px-3 py-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-[#E2B35E] text-xs font-semibold hover:bg-amber-500/20 whitespace-nowrap cursor-pointer"
                >
                  Admin AxyCore
                </button>
              </>
            ) : !isExternalClient ? (
              <button
                type="button"
                onClick={() => void switchPortalMode('corporate')}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-xs font-medium hover:bg-slate-100 dark:hover:bg-white/5 whitespace-nowrap cursor-pointer"
              >
                Consola Interna
              </button>
            ) : null}
            <button
              type="button"
              onClick={toggleDarkMode}
              className="p-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer"
              aria-label="Tema"
              title={darkMode ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            >
              {darkMode ? <Sun className="w-4 h-4 text-[#E2B35E]" /> : <Moon className="w-4 h-4 text-[#041B4E]" />}
            </button>
            <button
              type="button"
              onClick={() => setUserSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 text-xs font-medium whitespace-nowrap cursor-pointer"
              aria-label="Configuración de usuario"
            >
              <Sliders className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
              <span className="hidden sm:inline">Configuración</span>
            </button>
            <button
              type="button"
              onClick={logout}
              className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-white/10 text-white text-xs font-medium hover:opacity-90 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Salir
            </button>
          </div>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8">{children}</main>
        <UserSettingsModal
          open={userSettingsOpen}
          onClose={() => setUserSettingsOpen(false)}
        />
      </div>
    );
  }

  const getBadgeCount = (id: NavSectionId): number => {
    if (id === 'applications') return unreadAlertCount;
    if (id === 'cobranza_daily') return dailyTramoCount;
    if (id === 'cobranza_urgent') return urgentTramoCount;
    if (id === 'cobranza_legal') return legalTramoCount;
    if (id === 'cobranza_discounts' || id === 'cobranza_discounts_mora') return lateFeeAccountsCount;
    if (id === 'cobranza_agreements_today') return agreementsTodayCount;
    if (id === 'cobranza_agreements_broken') return agreementsBrokenCount;
    if (id === 'cobranza_sentinel') return activeAlertsCount;
    if (id === 'cobranza_unidentified') return openExceptionsCount;
    if (id === 'cobranza_payments') return pendingPaymentsCount;
    if (id === 'accounting_payment_validation') return pendingPaymentsCount;
    if (id === 'register_expense') return pendingExpensesCount;
    if (id === 'ecf_dgii_status') {
      return dgiiEcfDocuments.filter((d) =>
        ['PENDIENTE_RESPUESTA', 'ERROR_COMUNICACION'].includes(d.status)
      ).length;
    }
    return 0;
  };

  const userInitials = (userProfile?.displayName || userProfile?.email || 'AX')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className="min-h-screen bg-[#F5F7FB] dark:bg-[#030816] text-slate-950 dark:text-slate-100 flex">
      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#030816]/75 backdrop-blur-[2px] lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Dark Technological Left Sidebar (#040C1E) */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen bg-[#040C1E] text-slate-200 border-r border-[#00B8FF]/12 flex flex-col transition-[width,transform] duration-200 ${
          collapsed ? 'w-[72px]' : 'w-68'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div aria-hidden="true" className="h-[2px] w-full axy-infinity-line shrink-0" />
        {/* Top Logo Header */}
        <div className={`h-16 ${collapsed ? 'px-2.5 justify-center' : 'px-4 justify-between'} flex items-center border-b border-white/[0.06] shrink-0`}>
          <button
            type="button"
            onClick={() => handleSelectNav('dashboard')}
            className="flex items-center gap-2.5 overflow-hidden text-left cursor-pointer"
          >
            <div className="h-8 w-8 rounded-lg bg-white p-1 shadow-[0_0_16px_-4px_rgba(0,184,255,0.45)] ring-1 ring-[#00B8FF]/30 flex items-center justify-center shrink-0">
              <img
                src="/assets/aistudio/image_aea21874.png"
                alt="AxyCore"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
              />
            </div>
            {!collapsed && (
              <div className="truncate">
                <span className="font-display font-extrabold text-base tracking-tight text-white block leading-tight">
                  Axy<span className="axy-wordmark-core">Core</span>
                </span>
                <span className="text-[11px] font-medium text-[#00B8FF] block truncate">
                  Inteligencia Financiera
                </span>
              </div>
            )}
          </button>

          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#00B8FF]/10 cursor-pointer"
            aria-label={collapsed ? 'Expandir menú lateral' : 'Contraer menú lateral'}
            title={collapsed ? 'Expandir menú' : 'Contraer a íconos'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white"
            aria-label="Cerrar menú"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Active Tenant Workspace & Multi-Organization Switcher */}
        {collapsed && hasInstitutionalLogo && (
          <div className="px-2.5 py-2 border-b border-[#00B8FF]/12 bg-[#06122B] flex items-center justify-center shrink-0">
            <div
              className="h-9 w-9 rounded-lg bg-white p-1 border border-[#00B8FF]/25 flex items-center justify-center overflow-hidden"
              title={organization.tradeName || organization.name}
            >
              <img
                src={organization.logoUrl}
                alt={organization.tradeName || organization.name}
                referrerPolicy="no-referrer"
                onError={() => setOrgLogoFailed(true)}
                className="h-full w-full object-contain"
              />
            </div>
          </div>
        )}
        {!collapsed && (
          <div className="px-3 py-2.5 border-b border-[#00B8FF]/12 bg-[#06122B] space-y-2 shrink-0">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                Empresa Activa
              </span>
              <span className="text-[#E2B35E] text-[10px] font-mono font-bold tracking-wider">
                {organization.planCode || 'CORPORATIVO'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {hasInstitutionalLogo && (
                <div
                  className="h-9 w-9 rounded-lg bg-white p-1 border border-[#00B8FF]/25 flex items-center justify-center shrink-0 overflow-hidden"
                  title={organization.tradeName || organization.name}
                >
                  <img
                    src={organization.logoUrl}
                    alt={organization.tradeName || organization.name}
                    referrerPolicy="no-referrer"
                    onError={() => setOrgLogoFailed(true)}
                    className="h-full w-full object-contain"
                  />
                </div>
              )}
              {availableWorkspaces.length > 1 ? (
                <select
                  value={organization.id}
                  onChange={(e) => switchOrganizationWorkspace(e.target.value)}
                  aria-label="Cambiar empresa activa"
                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#040C1E] border border-[#00B8FF]/20 text-xs font-bold text-white cursor-pointer focus:border-[#00B8FF] focus:outline-none"
                >
                  {availableWorkspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.tradeName || ws.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#040C1E] border border-[#00B8FF]/15 text-xs font-bold text-white truncate">
                  {organization.tradeName || organization.name}
                </div>
              )}
            </div>

            {isSuperAdmin && (
              <div className="grid grid-cols-3 gap-1 pt-0.5">
                <button
                  type="button"
                  onClick={() => void switchPortalMode('axycore_admin')}
                  title="Administración de AxyCore (Platform Control SaaS)"
                  className={`px-1.5 py-1 rounded-lg text-[10px] font-semibold transition cursor-pointer text-center truncate ${
                    portalMode === 'axycore_admin' && activeSection === 'platform_control'
                      ? 'axy-brand-gradient text-white'
                      : 'bg-[#040C1E] hover:bg-[#0066FF]/20 text-[#E2B35E] border border-[#E2B35E]/25'
                  }`}
                >
                  Admin
                </button>
                <button
                  type="button"
                  onClick={() => void switchPortalMode('corporate', organization.id || 'org_axycore_main')}
                  title="Portal Corporativo"
                  className={`px-1.5 py-1 rounded-lg text-[10px] font-semibold transition cursor-pointer text-center truncate ${
                    portalMode === 'corporate' || (portalMode !== 'client' && activeSection !== 'platform_control')
                      ? 'axy-brand-gradient text-white'
                      : 'bg-[#040C1E] hover:bg-[#0066FF]/20 text-[#00D1FF] border border-[#00B8FF]/25'
                  }`}
                >
                  Corporativo
                </button>
                <button
                  type="button"
                  onClick={() => void switchPortalMode('client')}
                  title="Portal de Clientes"
                  className={`px-1.5 py-1 rounded-lg text-[10px] font-semibold transition cursor-pointer text-center truncate ${
                    portalMode === 'client'
                      ? 'axy-brand-gradient text-white'
                      : 'bg-[#040C1E] hover:bg-emerald-500/20 text-emerald-300 border border-emerald-400/25'
                  }`}
                >
                  Clientes
                </button>
              </div>
            )}

            {isPlatformAdminPortal && !isSuperAdmin && (
              <button
                type="button"
                onClick={() => void switchPortalMode('axycore_admin')}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                  activeSection === 'platform_control'
                    ? 'axy-brand-gradient text-white'
                    : 'bg-[#0066FF]/15 hover:bg-[#0066FF]/25 text-[#00D1FF] border border-[#00B8FF]/25'
                }`}
              >
                <span className="flex items-center gap-1.5 truncate">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#E2B35E] shrink-0" />
                  <span>Platform Control SaaS</span>
                </span>
                <ArrowRight className="w-3 h-3 shrink-0" />
              </button>
            )}
          </div>
        )}

        {/* Navigation Groups */}
        <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-2.5">
          {visibleGroups.map((group) => {
            const isOpen = openGroups[group.key] ?? false;
            const showSecondary = showAllSecondary[group.key] ?? false;
            const primaryItems = group.items.filter((i) => !i.secondary);
            const secondaryItems = group.items.filter((i) => i.secondary);
            const hasActiveInSecondary = secondaryItems.some((i) => i.id === activeSection);
            const hasActiveInGroup = group.items.some((i) => i.id === activeSection);
            const groupBadgeTotal = group.items.reduce(
              (sum, it) => sum + getBadgeCount(it.id),
              0
            );
            const displayedItems =
              collapsed || showSecondary || hasActiveInSecondary
                ? group.items
                : primaryItems;

            return (
              <div key={group.key} className="space-y-0.5">
                {!collapsed && (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenGroups((prev) => ({ ...prev, [group.key]: !isOpen }))
                    }
                    className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-[0.08em] transition-colors cursor-pointer ${
                      hasActiveInGroup
                        ? 'text-[#00D1FF]'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="truncate">{group.title}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {!isOpen && groupBadgeTotal > 0 && (
                        <span className="font-mono tabular-nums text-[10px] font-bold text-[#00D1FF]">
                          {groupBadgeTotal}
                        </span>
                      )}
                      {isOpen ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                      )}
                    </span>
                  </button>
                )}

                {(collapsed || isOpen) && (
                  <div className="space-y-0.5">
                    {displayedItems.map((item) => {
                      const Icon = item.icon;
                      const active = activeSection === item.id;
                      const count = getBadgeCount(item.id);
                      const parentItem = item.subItemOf
                        ? displayedItems.find((candidate) => candidate.id === item.subItemOf)
                        : undefined;
                      const depth = !item.subItemOf || collapsed ? 0 : parentItem?.subItemOf ? 2 : 1;
                      const isSubItem = depth > 0;

                      // Walk up subItemOf chain so 1-level and 2-level nested submenus collapse/expand cleanly
                      if (item.subItemOf && !collapsed) {
                        const isHiddenByCollapsedAncestor = (() => {
                          let cursorId: NavSectionId | undefined = item.subItemOf;
                          let guard = 0;
                          while (cursorId && guard < 4) {
                            const ancestorOpen = openSubMenus[cursorId] ?? true;
                            const hasActiveDescendant =
                              activeSection === cursorId ||
                              displayedItems.some((cand) => {
                                if (cand.id !== activeSection) return false;
                                let p = cand.subItemOf;
                                let g = 0;
                                while (p && g < 4) {
                                  if (p === cursorId) return true;
                                  p = displayedItems.find((x) => x.id === p)?.subItemOf;
                                  g += 1;
                                }
                                return false;
                              });
                            if (!ancestorOpen && !hasActiveDescendant) {
                              return true;
                            }
                            cursorId = displayedItems.find((x) => x.id === cursorId)?.subItemOf;
                            guard += 1;
                          }
                          return false;
                        })();
                        if (isHiddenByCollapsedAncestor) {
                          return null;
                        }
                      }

                      const hasChildren =
                        !collapsed &&
                        displayedItems.some((candidate) => candidate.subItemOf === item.id);
                      const isParentExpanded = openSubMenus[item.id] ?? true;

                      return (
                        <div
                          key={item.id}
                          className={
                            depth === 2
                              ? 'ml-7 pl-2 border-l border-[#00B8FF]/20'
                              : depth === 1
                              ? 'ml-4 pl-2 border-l border-[#00B8FF]/20'
                              : undefined
                          }
                        >
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleSelectNav(item.id)}
                              title={
                                collapsed
                                  ? `${item.label}${item.comingSoon ? ' (Próximamente)' : ''}`
                                  : undefined
                              }
                              className={`group relative flex-1 min-w-0 flex items-center ${
                                collapsed ? 'justify-center px-0 py-2.5' : `gap-2.5 px-3 ${isSubItem ? 'py-1.5 text-[12px]' : 'py-2 text-[13px]'}`
                              } rounded-xl font-medium transition-colors duration-150 cursor-pointer ${
                                active
                                  ? 'bg-[#0066FF] text-white font-semibold shadow-[0_4px_14px_-4px_rgba(0,102,255,0.6)]'
                                  : 'text-slate-300/90 hover:bg-white/[0.06] hover:text-white'
                              }`}
                            >
                              {active && !collapsed && (
                                <span
                                  aria-hidden="true"
                                  className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-[#00D1FF]"
                                />
                              )}
                              <Icon
                                className={`${
                                  isSubItem ? 'w-3.5 h-3.5' : 'w-4 h-4'
                                } shrink-0 transition-colors ${
                                  active
                                    ? 'text-white'
                                    : 'text-slate-400 group-hover:text-[#00B8FF]'
                                }`}
                              />
                              {!collapsed && (
                                <span
                                  className={`truncate flex-1 text-left ${
                                    item.id === 'ecf_dashboard' ? 'font-semibold text-white' : ''
                                  }`}
                                >
                                  {item.label}
                                </span>
                              )}
                              {!collapsed && item.id === 'ecf_dashboard' && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold tracking-wider shrink-0 ${
                                    active
                                      ? 'bg-white/20 text-white'
                                      : 'bg-[#00B8FF]/15 text-[#00D1FF] border border-[#00B8FF]/30'
                                  }`}
                                >
                                  e-CF
                                </span>
                              )}
                              {!collapsed && item.comingSoon && (
                                <span className="text-[10px] font-mono text-slate-400 shrink-0">
                                  Próx.
                                </span>
                              )}
                              {!collapsed && count > 0 && (
                                <span
                                  className={`font-mono tabular-nums text-[11px] font-bold shrink-0 ${
                                    active ? 'text-white' : 'text-[#00D1FF]'
                                  }`}
                                >
                                  {count}
                                </span>
                              )}
                            </button>
                            {hasChildren && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenSubMenus((prev) => ({
                                    ...prev,
                                    [item.id]: !(prev[item.id] ?? true),
                                  }));
                                }}
                                aria-label={
                                  isParentExpanded
                                    ? `Contraer submenú de ${item.label}`
                                    : `Expandir submenú de ${item.label}`
                                }
                                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#0066FF]/12 cursor-pointer shrink-0"
                              >
                                {isParentExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {!collapsed &&
                      secondaryItems.length > 0 &&
                      !hasActiveInSecondary && (
                        <button
                          type="button"
                          onClick={() =>
                            setShowAllSecondary((prev) => ({
                              ...prev,
                              [group.key]: !showSecondary,
                            }))
                          }
                          className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-200 cursor-pointer"
                        >
                          <span>
                            {showSecondary
                              ? 'Ocultar submódulos operativos'
                              : `Ver +${secondaryItems.length} submódulos`}
                          </span>
                          <ChevronDown
                            className={`w-3 h-3 transition-transform ${
                              showSecondary ? 'rotate-180' : ''
                            }`}
                          />
                        </button>
                      )}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-[#00B8FF]/12 space-y-2.5 shrink-0 bg-[#030918]">
          {!collapsed && (
            <>
              <PWAInstallButton />
              {(canOriginate || isSuperAdmin) && (
                <button
                  type="button"
                  onClick={() => void switchPortalMode('client')}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-[#00B8FF]/20 bg-[#071430]/75 hover:bg-[#0B1E47] text-xs font-medium text-slate-200 whitespace-nowrap cursor-pointer transition-colors"
                >
                  <Globe className="w-3.5 h-3.5 text-[#00B8FF] shrink-0" />
                  <span>Abrir Portal de Clientes</span>
                </button>
              )}
            </>
          )}
          <div className="flex items-center justify-between gap-2 px-1">
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">
                  {userProfile?.displayName}
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  {userProfile ? rbac.roleLabel : '—'}
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={logout}
              title="Cerrar sesión"
              className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/[0.06] shrink-0 cursor-pointer transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white/88 dark:bg-[#050E24]/88 backdrop-blur-xl border-b border-slate-200/80 dark:border-[#00B8FF]/14 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 overflow-hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-[#00B8FF]/20 text-slate-600 dark:text-slate-300 shrink-0 cursor-pointer"
              aria-label="Abrir menú"
            >
              <Menu className="w-4 h-4" />
            </button>
            {hasInstitutionalLogo && (
              <div
                className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg bg-white border border-slate-200/90 dark:border-[#00B8FF]/25 p-1 flex items-center justify-center shrink-0 overflow-hidden"
                title={organization.tradeName || organization.name}
              >
                <img
                  src={organization.logoUrl}
                  alt={organization.tradeName || organization.name}
                  referrerPolicy="no-referrer"
                  onError={() => setOrgLogoFailed(true)}
                  className="h-full w-full object-contain"
                />
              </div>
            )}
            <div className="min-w-0 flex-1 overflow-hidden">
              <NavigationBreadcrumbs
                variant="header"
                showSiblingSwitcher
                organizationLabel={organization.tradeName || organization.name}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Global Search Trigger */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200/90 dark:border-[#00B8FF]/20 bg-slate-50/90 dark:bg-[#08132B] text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-[#0066FF]/40 dark:hover:border-[#00B8FF]/45 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              title="Búsqueda global de clientes, documentos, préstamos, solicitudes, pagos y módulos (Ctrl+K)"
            >
              <Search className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
              <span className="hidden sm:inline">Buscar en AxyCore…</span>
              <kbd className="hidden md:inline-flex font-mono text-[10px] text-slate-400 dark:text-slate-500 items-center gap-0.5 pl-1.5 border-l border-slate-200 dark:border-white/10">
                <Command className="w-2.5 h-2.5" />K
              </kbd>
            </button>

            {/* Unified Calm Attention Indicator (consolidates Comité, Promesas & Centinela) */}
            {(() => {
              const committeeCount = rbac.canAccessSection('committee') ? pendingCommitteeCount : 0;
              const promisesCount = rbac.canAccessSection('cobranza_promises') ? brokenPromisesCount : 0;
              const sentinelCount = rbac.canAccessSection('cobranza_sentinel') ? activeAlertsCount : 0;
              const attentionTotal = committeeCount + promisesCount + sentinelCount;
              if (attentionTotal === 0) return null;
              const parts: string[] = [];
              if (committeeCount > 0) parts.push(`Comité: ${committeeCount}`);
              if (promisesCount > 0) parts.push(`Promesas: ${promisesCount}`);
              if (sentinelCount > 0) parts.push(`Centinela: ${sentinelCount}`);
              return (
                <button
                  type="button"
                  onClick={() => triggerOpenNotificationCenter()}
                  className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-amber-300/70 dark:border-[#E2B35E]/35 bg-amber-50/80 dark:bg-[#E2B35E]/10 hover:bg-amber-100/80 dark:hover:bg-[#E2B35E]/15 text-amber-800 dark:text-[#E2B35E] text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                  title={parts.join(' · ')}
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>Atención</span>
                  <span className="font-mono tabular-nums font-bold">{attentionTotal}</span>
                </button>
              );
            })()}

            {/* NotificationCenter in Dashboard Top Bar (Firestore notifications collection) */}
            <NotificationCenter />

            {/* Theme Switcher */}
            <button
              type="button"
              onClick={toggleDarkMode}
              className="p-2 rounded-xl border border-slate-200/90 dark:border-[#00B8FF]/20 bg-white dark:bg-[#08132B] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#0E1D40] cursor-pointer transition-colors"
              aria-label="Alternar modo claro u oscuro"
            >
              {darkMode ? <Sun className="w-4 h-4 text-[#E2B35E]" /> : <Moon className="w-4 h-4 text-[#041B4E]" />}
            </button>

            {/* User Avatar & Profile Menu */}
            <div ref={profileMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setProfileMenuOpen((v) => !v)}
                className="inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-xl border border-slate-200/90 dark:border-[#00B8FF]/20 bg-white dark:bg-[#08132B] hover:bg-slate-50 dark:hover:bg-[#0E1D40] cursor-pointer transition-colors"
                aria-label="Menú de perfil y configuración"
              >
                <div className="h-7 w-7 rounded-lg axy-brand-gradient text-white font-display text-xs font-bold flex items-center justify-center overflow-hidden shrink-0">
                  {firebaseUser?.photoURL && !avatarFailed ? (
                    <img
                      src={firebaseUser.photoURL}
                      alt={userProfile?.displayName || 'Usuario'}
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarFailed(true)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span>{userInitials}</span>
                  )}
                </div>
                <span className="hidden xl:inline text-xs font-semibold text-slate-800 dark:text-slate-200 max-w-[120px] truncate">
                  {userProfile?.displayName}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {profileMenuOpen && (
                <div className="axy-panel-in absolute right-0 mt-2 w-64 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 shadow-xl z-50 overflow-hidden text-xs">
                  <div className="p-3.5 border-b border-slate-100 dark:border-[#00B8FF]/12">
                    <p className="font-semibold text-slate-950 dark:text-white truncate">
                      {userProfile?.displayName}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {userProfile?.email}
                    </p>
                    <p className="text-[11px] font-mono text-[#0066FF] dark:text-[#00B8FF] mt-1">
                      {rbac.roleLabel} · {organization.name}
                    </p>
                  </div>

                  <div className="p-1.5 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setActiveSection('dashboard');
                      }}
                      className="w-full px-3 py-2 rounded-xl text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-slate-200 cursor-pointer"
                    >
                      <LayoutDashboard className="w-3.5 h-3.5 text-slate-400" />
                      <span>Dashboard Ejecutivo</span>
                    </button>

                    {rbac.canAccessSection('system_guide') && (
                      <button
                        type="button"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          setActiveSection('system_guide');
                        }}
                        className="w-full px-3 py-2 rounded-xl text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        <BookOpen className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
                        <span>Guía de AxyCore</span>
                      </button>
                    )}

                    {rbac.canAccessSection('system_sitemap') && (
                      <button
                        type="button"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          setActiveSection('system_sitemap');
                        }}
                        className="w-full px-3 py-2 rounded-xl text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        <Network className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
                        <span>Mapa del Sistema</span>
                      </button>
                    )}

                    <div className="my-1 py-1 border-y border-slate-100 dark:border-[#00B8FF]/12">
                      <ThemeSwitchControl variant="compact" />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setUserSettingsOpen(true);
                      }}
                      className="w-full px-3 py-2 rounded-xl text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-slate-200 cursor-pointer"
                    >
                      <Sliders className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
                      <span>Configuración de Usuario</span>
                    </button>

                    {rbac.canAccessSection('admin_settings') || rbac.canAccessSection('policies') ? (
                      <button
                        type="button"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          setActiveSection(
                            rbac.canAccessSection('admin_settings') ? 'admin_settings' : 'policies'
                          );
                        }}
                        className="w-full px-3 py-2 rounded-xl text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        <Settings className="w-3.5 h-3.5 text-slate-400" />
                        <span>Configuración Institucional</span>
                      </button>
                    ) : null}

                    {isSuperAdmin && (
                      <div className="my-1 pt-1 border-t border-slate-100 dark:border-[#00B8FF]/12 space-y-0.5">
                        <p className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                          Cambiar de Portal
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            void switchPortalMode('axycore_admin');
                          }}
                          className="w-full px-3 py-1.5 rounded-xl text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-slate-200 cursor-pointer"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-[#E2B35E]" />
                          <span>Admin AxyCore (SaaS)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            void switchPortalMode('corporate', 'org_axycore_main');
                          }}
                          className="w-full px-3 py-1.5 rounded-xl text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-slate-200 cursor-pointer"
                        >
                          <Briefcase className="w-3.5 h-3.5 text-[#00B8FF]" />
                          <span>Portal Corporativo (Su Gloria)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            void switchPortalMode('client');
                          }}
                          className="w-full px-3 py-1.5 rounded-xl text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-700 dark:text-slate-200 cursor-pointer"
                        >
                          <Wallet className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Portal de Clientes</span>
                        </button>
                      </div>
                    )}

                    {biometricSupported && (
                      <div className="my-1 pt-1 border-t border-slate-100 dark:border-[#00B8FF]/12 space-y-0.5">
                        {biometricEnrolled ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setProfileMenuOpen(false);
                                lockWithBiometrics();
                              }}
                              className="w-full px-3 py-2 rounded-xl text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/[0.05] text-[#0052CC] dark:text-[#00D1FF] font-semibold cursor-pointer"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              <span>Bloquear con {biometricLabel}</span>
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await disableBiometrics();
                                setBioFeedback(`${biometricLabel} desvinculado de este equipo.`);
                              }}
                              className="w-full px-3 py-2 rounded-xl text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/[0.05] text-slate-600 dark:text-slate-300 cursor-pointer"
                            >
                              <Fingerprint className="w-3.5 h-3.5 text-slate-400" />
                              <span>Desvincular {biometricLabel}</span>
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={async () => {
                              setBioFeedback(null);
                              const res = await enrollBiometrics();
                              setBioFeedback(
                                res.ok
                                  ? `${biometricLabel} activado correctamente.`
                                  : res.error || `No se pudo activar ${biometricLabel}.`
                              );
                            }}
                            className="w-full px-3 py-2 rounded-xl text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-white/[0.05] text-[#0052CC] dark:text-[#00D1FF] font-semibold cursor-pointer"
                          >
                            <ScanFace className="w-3.5 h-3.5" />
                            <span>Activar {biometricLabel}</span>
                          </button>
                        )}
                        {bioFeedback && (
                          <p className="px-3 py-1 text-[11px] text-slate-500 dark:text-slate-400">
                            {bioFeedback}
                          </p>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        logout();
                      }}
                      className="w-full px-3 py-2 rounded-xl text-left flex items-center gap-2 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 font-medium cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Cerrar sesión</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          <div key={activeSection} className="axy-view-enter">
            {children}
          </div>
        </main>
      </div>

      {/* Global Search Command Palette (⌘K / Ctrl+K) */}
      {paletteOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#030816]/70 backdrop-blur-xs flex items-start justify-center pt-[10vh] p-4"
          onClick={() => setPaletteOpen(false)}
        >
          <div
            className="axy-panel-in w-full max-w-2xl bg-white/96 dark:bg-[#07122B]/96 backdrop-blur-xl border border-slate-200/90 dark:border-[#00B8FF]/22 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Búsqueda global de AxyCore"
          >
            <div aria-hidden="true" className="h-[2px] w-full axy-ai-line" />
            <div className="px-4 py-3.5 border-b border-slate-200/80 dark:border-[#00B8FF]/14 flex items-center gap-3">
              <Search className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF] shrink-0" />
              <input
                ref={paletteInputRef}
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setPaletteIndex((i) => Math.min(i + 1, Math.max(0, paletteResults.length - 1)));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setPaletteIndex((i) => Math.max(i - 1, 0));
                  } else if (e.key === 'Enter' && paletteResults[paletteIndex]) {
                    e.preventDefault();
                    paletteResults[paletteIndex].onSelect();
                  }
                }}
                placeholder="Buscar clientes (nombre, cédula, RNC, teléfono), préstamos, solicitudes, pagos o módulos…"
                className="flex-1 bg-transparent text-sm text-slate-950 dark:text-white placeholder:text-slate-400 outline-none"
              />
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-slate-200 dark:border-white/10 text-slate-500 cursor-pointer"
              >
                ESC
              </button>
            </div>

            <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100 dark:divide-white/[0.06]">
              {paletteResults.length === 0 ? (
                <div className="py-10 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  No se encontraron registros ni módulos autorizados para «{paletteQuery}».
                </div>
              ) : (
                paletteResults.map((res, idx) => {
                  const selected = idx === paletteIndex;
                  return (
                    <button
                      key={res.key}
                      type="button"
                      onMouseEnter={() => setPaletteIndex(idx)}
                      onClick={res.onSelect}
                      className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[#0066FF]/10 dark:bg-[#0066FF]/20'
                          : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-950 dark:text-white truncate">
                          {res.title}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {res.subtitle}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          {res.group}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <CreditNotificationToasts />
      <BelaFloatingWidget />
      <OfflineIndicator />
      <UserSettingsModal
        open={userSettingsOpen}
        onClose={() => setUserSettingsOpen(false)}
      />
    </div>
  );
}
