import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from '../firebase/config';
import { DEFAULT_POLICY_V2 } from '../engine/decisionEngineV2';
import {
  bootstrapUserAndOrg,
  DEFAULT_ORG_ID,
  fetchBelaAssistantFromApi,
  fetchDirectorAnalysisFromApi,
  recordCriticalAuditEvent,
  revokeFcmDeviceToken,
  revokePushSubscriptionRecord,
  saveFcmDeviceToken,
  savePushSubscriptionRecord,
  updatePushSubscriptionPreferences,
} from '../services/axycoreStore';
import {
  buildOperationalDaySummary,
  buildRecentAuthorizedActivity,
  buildScopedAiContext,
  computeExecutiveCurrencyMetrics,
  getSantoDomingoClockInfo,
  resolvePeriodBounds,
  type ExecutiveCurrencyMetrics,
  type OperationalDayItem,
  type PeriodBounds,
  type RecentActivityItem,
  type SantoDomingoClockInfo,
} from '../engine/executiveAnalytics';
import {
  ALL_TRACKED_PUSH_STATUSES,
  buildApplicationCriticalPushPayload,
  buildInboxPushPayload,
  shouldTriggerApplicationCriticalPush,
  shouldTriggerInboxPush,
} from '../engine/pushPayload';
import {
  isVapidKeyConfigured,
  sendClientWebPushNotification,
  subscribeForegroundFcmMessages,
} from '../firebase/messaging';
import {
  isVapidWebPushSupported,
  registerPushSubscriptionWithServer,
  resolveVapidPublicKey,
  sendTestPushViaServerOrLocal,
  subscribeBrowserToVapidPush,
  unregisterPushSubscriptionFromServer,
  unsubscribeBrowserFromVapidPush,
} from '../services/pushSubscriptionService';
import {
  getStoredThemePreference,
  saveAndApplyThemePreference,
  THEME_STORAGE_KEY,
} from '../utils/themePreferences';
import {
  ALL_CREDIT_PERMISSIONS,
  CREDIT_ROLE_PROFILES,
  ROLE_PERMISSION_MATRIX,
  SECTION_ACCESS_BY_ROLE,
  canRoleAccessSection,
  getCreditWorkflowAccess,
  hasRolePermission,
  type CreditWorkflowAccessReport,
} from '../engine/rbac';
import {
  DEFAULT_COLLECTION_POLICY_V1,
  reconcileLiveCollectionAccounts,
} from '../engine/collections/delinquencyEngine';
import {
  checkTenantSectionAccess,
  isSuperAdminUser,
  resolveOrganizationByCorporateCode,
  SU_GLORIA_MANO_AMIGA_ORG,
} from '../engine/multiTenantEngine';
import { tenantService } from '../services/tenantService';
import {
  fetchAllOrgInstallments,
  syncDisbursedLoansAndDailyCutoff,
} from '../services/collectionsStore';
import {
  fetchUserMembershipsFromStore,
  switchActiveOrganizationInStore,
} from '../services/axycoreStore';
import {
  parseInvitationParamsFromSearch,
  type ParsedInvitationLinkParams,
} from '../engine/invitationFlow';
import {
  authenticateWithBiometricCredential,
  clearBiometricSessionUnlocked,
  detectBiometricCapabilities,
  detectBiometricPlatformLabel,
  enrollBiometricCredential,
  getLastStoredBiometricCredential,
  getStoredBiometricCredential,
  isBiometricSessionUnlocked,
  markBiometricSessionUnlocked,
  removeStoredBiometricCredential,
  type BiometricDeviceCredential,
  type BiometricFlowResult,
} from '../services/biometricAuth';
import { getEffectiveDgiiConfig } from '../services/dgiiEcfStore';
import { buildDefaultAlteraConfig } from '../engine/altera/alteraTwinAndDnaEngine';
import {
  createAlteraRecommendation,
  logAlteraAnalysisHistory,
  saveAlteraConfig,
  saveAlteraOutcomeCalibration,
  saveAlteraScenario,
  transitionAlteraRecommendationStatus,
} from '../services/alteraStore';
import type {
  AlteraAnalysisLogRecord,
  AlteraConfigRecord,
  AlteraOutcomeRecord,
  AlteraRecommendationRecord,
  AlteraRecommendationStatus,
  AlteraSavedScenarioRecord,
} from '../types/altera';
import type {
  AccountingAccountRecord,
  DgiiAuditLogRecord,
  DgiiCertificateRecord,
  DgiiEcfDocumentRecord,
  DgiiEncfSequenceRecord,
  DgiiFiscalConfigRecord,
  DgiiProductRecord,
  DgiiReceiverRecord,
  JournalEntryRecord,
} from '../types/dgiiEcf';
import type {
  ApplicationDecisionHistoryRecord,
  ApplicationDocumentRecord,
  ApplicationRecord,
  AuditLogRecord,
  AxyCoreModuleCode,
  BankTransactionRecord,
  BelaChatMessage,
  BusinessRecord,
  CollectionAccountRecord,
  CollectionActionRecord,
  CollectionAssignmentRecord,
  CollectionCampaignRecord,
  CollectionDailySnapshotRecord,
  CollectionPolicyVersionRecord,
  CollectionReceiptRecord,
  CollectionTaskRecord,
  FinancialAnalysisRecord,
  CollectorTargetRecord,
  CommitteeDecisionRecord,
  CreditEvaluationRecord,
  CreditPermission,
  CreditPolicyRecord,
  CustomerDisputeRecord,
  CustomerRecord,
  DirectorAnalysisResponse,
  DisbursementRecord,
  EmailNotificationRecord,
  ExecutiveCurrencyMode,
  ExecutivePeriodPreset,
  FcmDeviceTokenRecord,
  FcmPushStatus,
  FormalizationRecord,
  InvestorRecord,
  InvestorTransactionRecord,
  LoanInstallmentRecord,
  LoanRecord,
  MessageEventRecord,
  MessageTemplateRecord,
  NavSectionId,
  OperatingExpenseRecord,
  OrganizationMembershipRecord,
  OrganizationRecord,
  PaymentAgreementRecord,
  PaymentAllocationRecord,
  PaymentIntentRecord,
  PaymentPromiseRecord,
  PushDeliveryMode,
  PushSubscriptionRecord,
  PaymentRecord,
  PaymentReversalRecord,
  PortalAccessMode,
  ReconciliationExceptionRecord,
  ReconciliationMatchRecord,
  RiskAlertRecord,
  ScoringExecutionRecord,
  TenantLicenseRecord,
  TenantSubscriptionRecord,
  UserInvitationRecord,
  UserProfile,
  UserRole,
} from '../types/axycore';

export interface ResolvedCorporateOrgInfo {
  id: string;
  tenantId?: string;
  accessCode: string;
  name: string;
  tradeName?: string;
  status?: string;
  planCode?: string;
}

export type { NavSectionId } from '../types/axycore';

export interface CollectionsIntegrationsStatus {
  whatsappCloudApiConfigured: boolean;
  whatsappPhoneNumberIdPresent: boolean;
  bankConnectorConfigured: boolean;
  bankConnectorMode: 'CONECTADA' | 'INTEGRACION_PENDIENTE';
  whatsappMode: 'CONECTADA' | 'INTEGRACION_PENDIENTE';
}

export interface AxyCoreRbacContext {
  role: UserRole;
  roleLabel: string;
  roleSummary: string;
  workflowFocus: string;
  isInternalStaff: boolean;
  isReadOnlyAuditor: boolean;
  permissions: Record<CreditPermission, boolean>;
  hasPermission: (permission: CreditPermission) => boolean;
  canAccessSection: (section: NavSectionId) => boolean;
  allowedSections: NavSectionId[];
  getWorkflowAccess: (params: {
    application: ApplicationRecord;
    evaluation?: CreditEvaluationRecord | null;
    proposedAmount?: number;
  }) => CreditWorkflowAccessReport;
}

export type DesktopNotificationPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export interface InboxAlertItem {
  ackKey: string;
  application: ApplicationRecord;
  priority: 'INMEDIATA' | 'ALTA';
  reason: string;
  isUnread: boolean;
}

export interface LiveToastAlert {
  toastId: string;
  ackKey: string;
  applicationId: string;
  applicationNumber: string;
  applicantDisplayName: string;
  title: string;
  detail: string;
  channel: ApplicationRecord['channel'];
  status: ApplicationRecord['status'];
  createdAtIso: string;
}

interface AxyCoreContextValue {
  firebaseUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  authReady: boolean;
  dataLoading: boolean;
  darkMode: boolean;
  setDarkMode: (dark: boolean) => void;
  toggleDarkMode: () => void;
  activeSection: NavSectionId;
  setActiveSection: (section: NavSectionId) => void;
  externalPortalMode: boolean;
  setExternalPortalMode: (v: boolean) => void;
  selectedApplicationId: string | null;
  setSelectedApplicationId: (id: string | null) => void;
  selectedCollectionLoanId: string | null;
  setSelectedCollectionLoanId: (id: string | null) => void;
  signInWithGoogle: (loginHint?: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (params: {
    email: string;
    password: string;
    displayName?: string;
  }) => Promise<{ emailVerified: boolean; verificationSent: boolean }>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  reloadAuthUser: () => Promise<void>;
  emailVerificationPending: boolean;
  logout: () => Promise<void>;
  portalMode: PortalAccessMode | null;
  setPortalMode: (mode: PortalAccessMode | null) => void;
  switchPortalMode: (mode: PortalAccessMode, targetOrganizationId?: string) => Promise<void>;
  pendingInviteLinkInfo: ParsedInvitationLinkParams;
  selectedCorporateCode: string;
  resolvedCorporateOrg: ResolvedCorporateOrgInfo | null;
  resolveCorporateAccessCode: (code: string) => Promise<{
    ok: boolean;
    organization?: ResolvedCorporateOrgInfo;
    error?: string;
  }>;
  clearCorporateAccessSelection: () => void;
  portalAccessError: string | null;
  clearPortalAccessError: () => void;
  biometricSupported: boolean;
  biometricLabel: string;
  biometricEnrolled: boolean;
  biometricLocked: boolean;
  biometricSetupPending: boolean;
  lastBiometricCredential: BiometricDeviceCredential | null;
  enrollBiometrics: () => Promise<BiometricFlowResult>;
  unlockWithBiometrics: () => Promise<BiometricFlowResult>;
  lockWithBiometrics: () => void;
  disableBiometrics: () => Promise<void>;
  dismissBiometricSetup: () => void;
  requestPostLoginBiometricSetup: (enabled: boolean) => void;
  forgetQuickBiometricDevice: (uid?: string) => void;
  executivePeriod: ExecutivePeriodPreset;
  setExecutivePeriod: (preset: ExecutivePeriodPreset) => void;
  customRangeStart: string;
  customRangeEnd: string;
  setCustomRange: (startIso: string, endIso: string) => void;
  executiveCurrency: ExecutiveCurrencyMode;
  setExecutiveCurrency: (mode: ExecutiveCurrencyMode) => void;
  lastSyncedAtIso: string;
  clockInfo: SantoDomingoClockInfo;
  periodBounds: PeriodBounds;
  dopMetrics: ExecutiveCurrencyMetrics;
  usdMetrics: ExecutiveCurrencyMetrics;
  operationalDayItems: OperationalDayItem[];
  recentActivityItems: RecentActivityItem[];
  aiConfigured: boolean;
  directorAnalysis: DirectorAnalysisResponse | null;
  directorLoading: boolean;
  directorError: string | null;
  runDirectorAnalysis: (question?: string) => Promise<void>;
  belaOpen: boolean;
  setBelaOpen: (open: boolean) => void;
  belaMessages: BelaChatMessage[];
  belaLoading: boolean;
  sendBelaMessage: (message: string) => Promise<void>;
  clearBelaHistory: () => void;
  organization: OrganizationRecord;
  usersList: UserProfile[];
  userInvitations: UserInvitationRecord[];
  customers: CustomerRecord[];
  businesses: BusinessRecord[];
  applications: ApplicationRecord[];
  documents: ApplicationDocumentRecord[];
  policies: CreditPolicyRecord[];
  activeOrTestPolicy: CreditPolicyRecord;
  scoringExecutions: ScoringExecutionRecord[];
  financialAnalyses: FinancialAnalysisRecord[];
  applicationDecisionHistory: ApplicationDecisionHistoryRecord[];
  evaluations: CreditEvaluationRecord[];
  committeeDecisions: CommitteeDecisionRecord[];
  formalizations: FormalizationRecord[];
  disbursements: DisbursementRecord[];
  loans: LoanRecord[];
  loanInstallments: LoanInstallmentRecord[];
  collectionAccounts: CollectionAccountRecord[];
  collectionAssignments: CollectionAssignmentRecord[];
  collectionActions: CollectionActionRecord[];
  collectionTasks: CollectionTaskRecord[];
  paymentPromises: PaymentPromiseRecord[];
  paymentAgreements: PaymentAgreementRecord[];
  payments: PaymentRecord[];
  paymentAllocations: PaymentAllocationRecord[];
  paymentReversals: PaymentReversalRecord[];
  collectionReceipts: CollectionReceiptRecord[];
  paymentIntents: PaymentIntentRecord[];
  bankTransactions: BankTransactionRecord[];
  reconciliationMatches: ReconciliationMatchRecord[];
  reconciliationExceptions: ReconciliationExceptionRecord[];
  collectorTargets: CollectorTargetRecord[];
  collectionCampaigns: CollectionCampaignRecord[];
  messageTemplates: MessageTemplateRecord[];
  messageEvents: MessageEventRecord[];
  riskAlerts: RiskAlertRecord[];
  customerDisputes: CustomerDisputeRecord[];
  collectionPolicies: CollectionPolicyVersionRecord[];
  activeCollectionPolicy: CollectionPolicyVersionRecord;
  collectionDailySnapshots: CollectionDailySnapshotRecord[];
  collectionsIntegrationsStatus: CollectionsIntegrationsStatus;
  runDailyCollectionsSync: (opts?: {
    asOfDateIso?: string;
    saveSnapshot?: boolean;
  }) => Promise<{ syncedLoans: number; newAlerts: number; newTasks: number }>;
  refreshInstallments: () => Promise<void>;
  operatingExpenses: OperatingExpenseRecord[];
  investors: InvestorRecord[];
  investorTransactions: InvestorTransactionRecord[];
  accountingAccounts: AccountingAccountRecord[];
  journalEntries: JournalEntryRecord[];
  dgiiFiscalConfigs: DgiiFiscalConfigRecord[];
  activeDgiiConfig: DgiiFiscalConfigRecord;
  dgiiCertificates: DgiiCertificateRecord[];
  dgiiSequences: DgiiEncfSequenceRecord[];
  dgiiReceivers: DgiiReceiverRecord[];
  dgiiProducts: DgiiProductRecord[];
  dgiiEcfDocuments: DgiiEcfDocumentRecord[];
  dgiiAuditLogs: DgiiAuditLogRecord[];
  alteraScenarios: AlteraSavedScenarioRecord[];
  alteraRecommendations: AlteraRecommendationRecord[];
  alteraOutcomes: AlteraOutcomeRecord[];
  alteraAnalyses: AlteraAnalysisLogRecord[];
  alteraConfig: AlteraConfigRecord;
  saveAlteraScenarioEntry: (
    scenario: Omit<
      AlteraSavedScenarioRecord,
      'id' | 'organizationId' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'
    >
  ) => Promise<AlteraSavedScenarioRecord>;
  createAlteraRecommendationEntry: (params: {
    initialStatus?: 'GENERADA' | 'PENDIENTE_REVISION';
    recommendation: Omit<
      AlteraRecommendationRecord,
      | 'id'
      | 'organizationId'
      | 'code'
      | 'createdAtIso'
      | 'status'
      | 'followUpHistory'
      | 'createdBy'
      | 'createdByName'
      | 'createdAt'
      | 'updatedAt'
    >;
    initialNotes?: string;
  }) => Promise<AlteraRecommendationRecord>;
  updateAlteraRecommendationStatus: (params: {
    recommendation: AlteraRecommendationRecord;
    nextStatus: AlteraRecommendationStatus;
    notes?: string;
  }) => Promise<AlteraRecommendationRecord>;
  recordAlteraOutcomeCalibration: (
    outcome: Omit<
      AlteraOutcomeRecord,
      'id' | 'organizationId' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'
    >
  ) => Promise<AlteraOutcomeRecord>;
  logAlteraAnalysis: (
    entry: Omit<
      AlteraAnalysisLogRecord,
      'id' | 'organizationId' | 'actorUid' | 'actorName' | 'actorRole' | 'createdAtIso' | 'createdAt'
    >
  ) => Promise<AlteraAnalysisLogRecord | null>;
  updateAlteraConfigSettings: (
    config: Partial<
      Omit<
        AlteraConfigRecord,
        | 'id'
        | 'organizationId'
        | 'requireHumanApprovalForAllInterventions'
        | 'updatedBy'
        | 'updatedByName'
        | 'createdAt'
        | 'updatedAt'
      >
    >
  ) => Promise<AlteraConfigRecord>;
  auditLogs: AuditLogRecord[];
  emailNotifications: EmailNotificationRecord[];
  smtpConfigured: boolean;
  inboxAlerts: InboxAlertItem[];
  unreadAlertCount: number;
  liveToasts: LiveToastAlert[];
  dismissLiveToast: (toastId: string) => void;
  acknowledgeAlert: (ackKey: string) => void;
  acknowledgeAllAlerts: () => void;
  desktopNotifPermission: DesktopNotificationPermission;
  desktopNotifEnabled: boolean;
  requestDesktopNotifications: () => Promise<DesktopNotificationPermission>;
  toggleDesktopNotifications: () => void;
  fcmStatus: FcmPushStatus;
  fcmToken: string | null;
  fcmError: string | null;
  fcmVapidConfigured: boolean;
  fcmActiveDevicesCount: number;
  pushDeliveryMode: PushDeliveryMode | null;
  pushSubscribedStatuses: ApplicationRecord['status'][];
  enableFcmPush: () => Promise<void>;
  disableFcmPush: () => Promise<void>;
  updatePushStatusPreferences: (statuses: ApplicationRecord['status'][]) => Promise<void>;
  sendTestPush: () => Promise<{ delivered: boolean; channel: string }>;
  rbac: AxyCoreRbacContext;
  isSuperAdmin: boolean;
  isPlatformAdminPortal: boolean;
  allOrganizations: OrganizationRecord[];
  organizationMemberships: OrganizationMembershipRecord[];
  tenantLicenses: TenantLicenseRecord[];
  tenantSubscriptions: TenantSubscriptionRecord[];
  availableWorkspaces: OrganizationRecord[];
  switchOrganizationWorkspace: (targetOrganizationId: string) => Promise<void>;
  getSectionTenantAccess: (section: NavSectionId) => {
    allowed: boolean;
    reason?: string;
    requiredModule?: AxyCoreModuleCode | null;
  };
  tenantService: typeof tenantService;
}

const AxyCoreContext = createContext<AxyCoreContextValue | null>(null);

const FALLBACK_POLICY: CreditPolicyRecord = {
  ...DEFAULT_POLICY_V2,
  createdBy: 'system',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const DEFAULT_INTEGRATIONS_STATUS: CollectionsIntegrationsStatus = {
  whatsappCloudApiConfigured: false,
  whatsappPhoneNumberIdPresent: false,
  bankConnectorConfigured: false,
  bankConnectorMode: 'INTEGRACION_PENDIENTE',
  whatsappMode: 'INTEGRACION_PENDIENTE',
};

export function AxyCoreProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return getStoredThemePreference() === 'dark';
  });

  const [pendingInviteLinkInfo] = useState<ParsedInvitationLinkParams>(() => {
    if (typeof window === 'undefined') {
      return { inviteId: null, orgCode: null, email: null, isInvitationLink: false };
    }
    return parseInvitationParamsFromSearch(window.location.search);
  });

  const [portalMode, setPortalModeState] = useState<PortalAccessMode | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get('channel') === 'external') return 'client';
    const inv = parseInvitationParamsFromSearch(window.location.search);
    if (inv.isInvitationLink) return 'corporate';
    const stored = window.sessionStorage.getItem('axycore_portal_mode');
    if (stored === 'axycore_admin' || stored === 'corporate' || stored === 'client') {
      return stored;
    }
    return null;
  });
  const portalModeRef = useRef<PortalAccessMode | null>(portalMode);
  portalModeRef.current = portalMode;

  const [selectedCorporateCode, setSelectedCorporateCode] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    const inv = parseInvitationParamsFromSearch(window.location.search);
    if (inv.orgCode) return inv.orgCode;
    if (inv.isInvitationLink) return SU_GLORIA_MANO_AMIGA_ORG.accessCode || 'SGMA-001';
    return window.sessionStorage.getItem('axycore_corporate_code') || '';
  });
  const [resolvedCorporateOrg, setResolvedCorporateOrg] = useState<ResolvedCorporateOrgInfo | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem('axycore_resolved_corp_org');
      return raw ? (JSON.parse(raw) as ResolvedCorporateOrgInfo) : null;
    } catch {
      return null;
    }
  });
  const resolvedCorporateOrgRef = useRef<ResolvedCorporateOrgInfo | null>(resolvedCorporateOrg);
  resolvedCorporateOrgRef.current = resolvedCorporateOrg;

  const [portalAccessError, setPortalAccessError] = useState<string | null>(null);

  const [biometricSupported, setBiometricSupported] = useState<boolean>(false);
  const [biometricLabel, setBiometricLabel] = useState<string>(() => detectBiometricPlatformLabel());
  const [biometricLocked, setBiometricLocked] = useState<boolean>(false);
  const [biometricSetupPending, setBiometricSetupPending] = useState<boolean>(false);
  const [lastBiometricCredential, setLastBiometricCredential] =
    useState<BiometricDeviceCredential | null>(() => getLastStoredBiometricCredential());
  const postLoginBiometricSetupRef = useRef<boolean>(false);

  const setPortalMode = useCallback((mode: PortalAccessMode | null) => {
    setPortalModeState(mode);
    portalModeRef.current = mode;
    setPortalAccessError(null);
    if (typeof window !== 'undefined') {
      if (mode) {
        window.sessionStorage.setItem('axycore_portal_mode', mode);
      } else {
        window.sessionStorage.removeItem('axycore_portal_mode');
      }
    }
  }, []);

  const clearCorporateAccessSelection = useCallback(() => {
    setSelectedCorporateCode('');
    setResolvedCorporateOrg(null);
    resolvedCorporateOrgRef.current = null;
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem('axycore_corporate_code');
      window.sessionStorage.removeItem('axycore_resolved_corp_org');
    }
  }, []);

  const clearPortalAccessError = useCallback(() => {
    setPortalAccessError(null);
  }, []);

  const [externalPortalMode, setExternalPortalMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('channel') === 'external';
  });

  const [intendedSection, setIntendedSection] = useState<NavSectionId | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const paramSection = params.get('section') as NavSectionId | null;
    if (paramSection) return paramSection;
    const stored = window.sessionStorage.getItem('axycore_intended_section') as NavSectionId | null;
    return stored || null;
  });

  const [activeSection, setActiveSection] = useState<NavSectionId>('dashboard');
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [selectedCollectionLoanId, setSelectedCollectionLoanId] = useState<string | null>(null);

  const [executivePeriod, setExecutivePeriod] = useState<ExecutivePeriodPreset>('CURRENT_MONTH');
  const [customRangeStart, setCustomRangeStart] = useState<string>('');
  const [customRangeEnd, setCustomRangeEnd] = useState<string>('');
  const [executiveCurrency, setExecutiveCurrency] = useState<ExecutiveCurrencyMode>('DOP');
  const [lastSyncedAtIso, setLastSyncedAtIso] = useState<string>(() => new Date().toISOString());

  const [aiConfigured, setAiConfigured] = useState<boolean>(false);
  const [directorAnalysis, setDirectorAnalysis] = useState<DirectorAnalysisResponse | null>(null);
  const [directorLoading, setDirectorLoading] = useState<boolean>(false);
  const [directorError, setDirectorError] = useState<string | null>(null);

  const [belaOpen, setBelaOpen] = useState<boolean>(false);
  const [belaLoading, setBelaLoading] = useState<boolean>(false);
  const [belaMessages, setBelaMessages] = useState<BelaChatMessage[]>([
    {
      id: 'bela_welcome',
      role: 'assistant',
      content: '¡Hola! Soy Bela, tu asistente inteligente. ¿En qué puedo ayudarte hoy?',
      timestampIso: new Date().toISOString(),
    },
  ]);

  const setCustomRange = useCallback((startIso: string, endIso: string) => {
    setCustomRangeStart(startIso);
    setCustomRangeEnd(endIso);
    setExecutivePeriod('CUSTOM');
  }, []);

  const [organization, setOrganization] = useState<OrganizationRecord>({
    ...SU_GLORIA_MANO_AMIGA_ORG,
  });
  const [allOrganizations, setAllOrganizations] = useState<OrganizationRecord[]>([
    SU_GLORIA_MANO_AMIGA_ORG,
  ]);
  const [organizationMemberships, setOrganizationMemberships] = useState<OrganizationMembershipRecord[]>([]);
  const [tenantLicenses, setTenantLicenses] = useState<TenantLicenseRecord[]>([]);
  const [tenantSubscriptions, setTenantSubscriptions] = useState<TenantSubscriptionRecord[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [userInvitations, setUserInvitations] = useState<UserInvitationRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [documents, setDocuments] = useState<ApplicationDocumentRecord[]>([]);
  const [policies, setPolicies] = useState<CreditPolicyRecord[]>([FALLBACK_POLICY]);
  const [scoringExecutions, setScoringExecutions] = useState<ScoringExecutionRecord[]>([]);
  const [financialAnalyses, setFinancialAnalyses] = useState<FinancialAnalysisRecord[]>([]);
  const [applicationDecisionHistory, setApplicationDecisionHistory] = useState<ApplicationDecisionHistoryRecord[]>([]);
  const [evaluations, setEvaluations] = useState<CreditEvaluationRecord[]>([]);
  const [committeeDecisions, setCommitteeDecisions] = useState<CommitteeDecisionRecord[]>([]);
  const [formalizations, setFormalizations] = useState<FormalizationRecord[]>([]);
  const [disbursements, setDisbursements] = useState<DisbursementRecord[]>([]);
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [loanInstallments, setLoanInstallments] = useState<LoanInstallmentRecord[]>([]);
  const [rawCollectionAccounts, setCollectionAccounts] = useState<CollectionAccountRecord[]>([]);
  const [collectionAssignments, setCollectionAssignments] = useState<CollectionAssignmentRecord[]>([]);
  const [collectionActions, setCollectionActions] = useState<CollectionActionRecord[]>([]);
  const [collectionTasks, setCollectionTasks] = useState<CollectionTaskRecord[]>([]);
  const [paymentPromises, setPaymentPromises] = useState<PaymentPromiseRecord[]>([]);
  const [paymentAgreements, setPaymentAgreements] = useState<PaymentAgreementRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentAllocations, setPaymentAllocations] = useState<PaymentAllocationRecord[]>([]);
  const [paymentReversals, setPaymentReversals] = useState<PaymentReversalRecord[]>([]);
  const [collectionReceipts, setCollectionReceipts] = useState<CollectionReceiptRecord[]>([]);
  const [paymentIntents, setPaymentIntents] = useState<PaymentIntentRecord[]>([]);
  const [bankTransactions, setBankTransactions] = useState<BankTransactionRecord[]>([]);
  const [reconciliationMatches, setReconciliationMatches] = useState<ReconciliationMatchRecord[]>([]);
  const [reconciliationExceptions, setReconciliationExceptions] = useState<ReconciliationExceptionRecord[]>([]);
  const [collectorTargets, setCollectorTargets] = useState<CollectorTargetRecord[]>([]);
  const [collectionCampaigns, setCollectionCampaigns] = useState<CollectionCampaignRecord[]>([]);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplateRecord[]>([]);
  const [messageEvents, setMessageEvents] = useState<MessageEventRecord[]>([]);
  const [riskAlerts, setRiskAlerts] = useState<RiskAlertRecord[]>([]);
  const [customerDisputes, setCustomerDisputes] = useState<CustomerDisputeRecord[]>([]);
  const [collectionPolicies, setCollectionPolicies] = useState<CollectionPolicyVersionRecord[]>([
    DEFAULT_COLLECTION_POLICY_V1,
  ]);
  const [collectionDailySnapshots, setCollectionDailySnapshots] = useState<CollectionDailySnapshotRecord[]>([]);
  const [collectionsIntegrationsStatus, setCollectionsIntegrationsStatus] =
    useState<CollectionsIntegrationsStatus>(DEFAULT_INTEGRATIONS_STATUS);
  const [operatingExpenses, setOperatingExpenses] = useState<OperatingExpenseRecord[]>([]);
  const [investors, setInvestors] = useState<InvestorRecord[]>([]);
  const [investorTransactions, setInvestorTransactions] = useState<InvestorTransactionRecord[]>([]);
  const [accountingAccounts, setAccountingAccounts] = useState<AccountingAccountRecord[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntryRecord[]>([]);
  const [dgiiFiscalConfigs, setDgiiFiscalConfigs] = useState<DgiiFiscalConfigRecord[]>([]);
  const [dgiiCertificates, setDgiiCertificates] = useState<DgiiCertificateRecord[]>([]);
  const [dgiiSequences, setDgiiSequences] = useState<DgiiEncfSequenceRecord[]>([]);
  const [dgiiReceivers, setDgiiReceivers] = useState<DgiiReceiverRecord[]>([]);
  const [dgiiProducts, setDgiiProducts] = useState<DgiiProductRecord[]>([]);
  const [dgiiEcfDocuments, setDgiiEcfDocuments] = useState<DgiiEcfDocumentRecord[]>([]);
  const [dgiiAuditLogs, setDgiiAuditLogs] = useState<DgiiAuditLogRecord[]>([]);
  const [alteraScenarios, setAlteraScenarios] = useState<AlteraSavedScenarioRecord[]>([]);
  const [alteraRecommendations, setAlteraRecommendations] = useState<AlteraRecommendationRecord[]>([]);
  const [alteraOutcomes, setAlteraOutcomes] = useState<AlteraOutcomeRecord[]>([]);
  const [alteraAnalyses, setAlteraAnalyses] = useState<AlteraAnalysisLogRecord[]>([]);
  const [alteraConfigs, setAlteraConfigs] = useState<AlteraConfigRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [emailNotifications, setEmailNotifications] = useState<EmailNotificationRecord[]>([]);
  const [smtpConfigured, setSmtpConfigured] = useState<boolean>(false);
  const [fcmVapidConfigured, setFcmVapidConfigured] = useState<boolean>(() => isVapidKeyConfigured());
  const [fcmStatus, setFcmStatus] = useState<FcmPushStatus>('idle');
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [fcmError, setFcmError] = useState<string | null>(null);
  const [fcmDeviceTokens, setFcmDeviceTokens] = useState<FcmDeviceTokenRecord[]>([]);
  const [pushSubscriptions, setPushSubscriptions] = useState<PushSubscriptionRecord[]>([]);
  const [pushSubscriptionId, setPushSubscriptionId] = useState<string | null>(null);
  const [pushEndpoint, setPushEndpoint] = useState<string | null>(null);
  const [pushDeliveryMode, setPushDeliveryMode] = useState<PushDeliveryMode | null>(null);
  const [pushSubscribedStatuses, setPushSubscribedStatuses] = useState<ApplicationRecord['status'][]>(
    () => {
      if (typeof window === 'undefined') return [...ALL_TRACKED_PUSH_STATUSES];
      try {
        const raw = window.localStorage.getItem('axycore_push_statuses');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed as ApplicationRecord['status'][];
          }
        }
      } catch {
        // Fallback to all tracked statuses
      }
      return [...ALL_TRACKED_PUSH_STATUSES];
    }
  );
  const pushSubscribedStatusesRef = useRef<ApplicationRecord['status'][]>(pushSubscribedStatuses);
  pushSubscribedStatusesRef.current = pushSubscribedStatuses;

  // Live-reconciled collectionAccounts: always reflects freshly applied payments,
  // paid installments, and zeroed balances immediately without waiting for manual sync.
  const collectionAccounts = useMemo(() => {
    const activePolicy =
      collectionPolicies.find((p) => p.status === 'ACTIVA') ??
      collectionPolicies.find((p) => p.status === 'PROPUESTA') ??
      DEFAULT_COLLECTION_POLICY_V1;
    return reconcileLiveCollectionAccounts({
      loans,
      installments: loanInstallments,
      existingAccounts: rawCollectionAccounts,
      customers,
      payments,
      promises: paymentPromises,
      actions: collectionActions,
      disputes: customerDisputes,
      policy: activePolicy,
    });
  }, [
    collectionPolicies,
    loans,
    loanInstallments,
    rawCollectionAccounts,
    customers,
    payments,
    paymentPromises,
    collectionActions,
    customerDisputes,
  ]);

  // Real-time notification state for credit staff Inbox attention
  const [acknowledgedKeys, setAcknowledgedKeys] = useState<string[]>([]);
  const [liveToasts, setLiveToasts] = useState<LiveToastAlert[]>([]);
  const [desktopNotifPermission, setDesktopNotifPermission] = useState<DesktopNotificationPermission>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return window.Notification.permission as DesktopNotificationPermission;
  });
  const [desktopNotifEnabled, setDesktopNotifEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('axycore_desktop_notif') !== 'false';
  });
  const hasInitialAppsSnapshotRef = useRef(false);
  const knownAppStatusRef = useRef<Map<string, string>>(new Map());
  const recentAlertAckRef = useRef<Map<string, number>>(new Map());
  const desktopNotifEnabledRef = useRef(desktopNotifEnabled);
  desktopNotifEnabledRef.current = desktopNotifEnabled;

  useEffect(() => {
    saveAndApplyThemePreference(darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && event.newValue) {
        setDarkMode(event.newValue === 'dark');
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--axy-primary', organization.primaryColor || '#0f3d91');
    document.documentElement.style.setProperty('--axy-accent', organization.accentColor || '#0284c7');
  }, [organization.primaryColor, organization.accentColor]);

  useEffect(() => {
    fetch('/api/notifications/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.smtpConfigured === 'boolean') {
          setSmtpConfigured(data.smtpConfigured);
        }
        if (data && typeof data.fcmVapidConfigured === 'boolean') {
          setFcmVapidConfigured((prev) => prev || Boolean(data.fcmVapidConfigured));
        }
      })
      .catch(() => {});

    fetch('/api/collections/integrations-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.whatsappCloudApiConfigured === 'boolean') {
          setCollectionsIntegrationsStatus({
            whatsappCloudApiConfigured: Boolean(data.whatsappCloudApiConfigured),
            whatsappPhoneNumberIdPresent: Boolean(data.whatsappPhoneNumberIdPresent),
            bankConnectorConfigured: Boolean(data.bankConnectorConfigured),
            bankConnectorMode: data.bankConnectorMode === 'CONECTADA' ? 'CONECTADA' : 'INTEGRACION_PENDIENTE',
            whatsappMode: data.whatsappMode === 'CONECTADA' ? 'CONECTADA' : 'INTEGRACION_PENDIENTE',
          });
        }
      })
      .catch(() => {});

    fetch('/api/ai/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.configured === 'boolean') {
          setAiConfigured(Boolean(data.configured));
        }
      })
      .catch(() => {});

    // Handle deep-link query params from Web Push notification clicks or protected routes
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const appId = params.get('applicationId');
      const sec = params.get('section') as NavSectionId | null;
      if (appId) setSelectedApplicationId(appId);
      if (sec) {
        setIntendedSection(sec);
        window.sessionStorage.setItem('axycore_intended_section', sec);
      }
    }

    // Listen to Service Worker notification clicks while the app tab is open
    const handleSwMessage = (event: MessageEvent) => {
      if (
        event.data &&
        (event.data.type === 'AXYCORE_FCM_CLICK' || event.data.type === 'AXYCORE_PUSH_CLICK')
      ) {
        if (event.data.applicationId) {
          setSelectedApplicationId(String(event.data.applicationId));
        }
        if (event.data.targetSection) {
          setActiveSection(event.data.targetSection as NavSectionId);
        }
      }
    };
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('message', handleSwMessage);
    }

    detectBiometricCapabilities()
      .then((caps) => {
        setBiometricSupported(caps.supported);
        setBiometricLabel(caps.label);
      })
      .catch(() => {});

    testFirestoreConnection();
    const finalizeAuthenticatedSession = async (fbUser: FirebaseUser) => {
      try {
        let profile = await bootstrapUserAndOrg(fbUser);
        const activePortal = portalModeRef.current;
        const targetCorp = resolvedCorporateOrgRef.current;
        const superUser = isSuperAdminUser(profile, fbUser.emailVerified);

        // Enforce selected entry portal mode rules cleanly
        if (activePortal === 'axycore_admin') {
          if (!superUser) {
            setPortalAccessError(
              `La cuenta ${profile.email} no posee privilegios de Superadministrador AxyCore para administrar Platform Control SaaS. Selecciona Acceso Corporativo o Portal de Clientes.`
            );
            setUserProfile(profile);
            setAuthReady(true);
            return;
          }
          setExternalPortalMode(false);
          setActiveSection('platform_control');
        } else if (activePortal === 'corporate') {
          if (profile.role === 'EXTERNAL_CLIENT' && !superUser) {
            setPortalAccessError(
              `Tu cuenta (${profile.email}) está registrada como Cliente Externo y no cuenta con una invitación o rol corporativo activo. Pide a tu Administrador que envíe tu invitación o ingresa por el Portal de Clientes.`
            );
            setUserProfile(profile);
            setAuthReady(true);
            return;
          }
          if (targetCorp && targetCorp.id && profile.organizationId !== targetCorp.id) {
            try {
              const userMemberships = await fetchUserMembershipsFromStore(profile.uid);
              profile = await switchActiveOrganizationInStore({
                user: profile,
                targetOrganizationId: targetCorp.id,
                organizations: [
                  SU_GLORIA_MANO_AMIGA_ORG,
                  {
                    ...SU_GLORIA_MANO_AMIGA_ORG,
                    id: targetCorp.id,
                    organizationId: targetCorp.id,
                    tenantId: targetCorp.tenantId || targetCorp.id,
                    accessCode: targetCorp.accessCode,
                    name: targetCorp.name,
                    tradeName: targetCorp.tradeName || targetCorp.name,
                    status: (targetCorp.status as OrganizationRecord['status']) || 'ACTIVA',
                  },
                ],
                memberships: userMemberships,
                isSuperAdmin: superUser,
              });
            } catch {
              setPortalAccessError(
                `Tu cuenta (${profile.email}) no tiene membresía activa en la empresa "${
                  targetCorp.tradeName || targetCorp.name
                }" (Código: ${targetCorp.accessCode}).`
              );
              setUserProfile(profile);
              setAuthReady(true);
              return;
            }
          }
          setExternalPortalMode(false);
          setActiveSection('dashboard');
        } else if (activePortal === 'client') {
          setExternalPortalMode(true);
          setActiveSection('loans');
        } else {
          // Direct session restore or automatic login after email activation link
          if (profile.role === 'EXTERNAL_CLIENT' && !superUser) {
            setPortalMode('client');
            setExternalPortalMode(true);
            setActiveSection('loans');
          } else {
            setPortalMode('corporate');
            setExternalPortalMode(false);
            setActiveSection('dashboard');
          }
        }

        // Clear invitation query parameters from address bar after automatic login so reload is clean
        if (typeof window !== 'undefined' && window.location.search.includes('invite=')) {
          try {
            window.history.replaceState({}, document.title, window.location.pathname);
          } catch {
            // ignore
          }
        }

        setPortalAccessError(null);
        setUserProfile(profile);
        tenantService.setCurrentUser(profile);

        // Biometric FaceID/TouchID session lock check
        const storedCred = getStoredBiometricCredential(fbUser.uid);
        const sessionUnlocked = isBiometricSessionUnlocked(fbUser.uid);
        if (storedCred) {
          setLastBiometricCredential(storedCred);
          if (!sessionUnlocked) {
            setBiometricLocked(true);
          } else {
            setBiometricLocked(false);
            if (profile.role !== 'EXTERNAL_CLIENT') {
              recordCriticalAuditEvent({
                user: profile,
                eventType: 'AUTH_LOGIN_SUCCESS',
                entityType: 'users',
                entityId: profile.uid,
                action: `Inicio de sesión verificado en AxyCore (${profile.email})`,
                newState: `${profile.role} · SESION_ACTIVA`,
                justification: `Proveedor: ${fbUser.providerData[0]?.providerId || 'firebase'}`,
              }).catch(() => {});
            }
          }
        } else {
          setBiometricLocked(false);
          if (postLoginBiometricSetupRef.current) {
            postLoginBiometricSetupRef.current = false;
            setBiometricSetupPending(true);
          }
          if (profile.role !== 'EXTERNAL_CLIENT') {
            recordCriticalAuditEvent({
              user: profile,
              eventType: 'AUTH_LOGIN_SUCCESS',
              entityType: 'users',
              entityId: profile.uid,
              action: `Inicio de sesión verificado en AxyCore (${profile.email})`,
              newState: `${profile.role} · SESION_ACTIVA`,
              justification: `Proveedor: ${fbUser.providerData[0]?.providerId || 'firebase'}`,
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.error('Bootstrap error:', err);
      } finally {
        setAuthReady(true);
      }
    };

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (!fbUser) {
        setUserProfile(null);
        setBiometricLocked(false);
        setBiometricSetupPending(false);
        setLastBiometricCredential(getLastStoredBiometricCredential());
        setAuthReady(true);
        return;
      }
      if (!fbUser.emailVerified) {
        // Hold Firestore listeners until email is verified per Zero-Trust rules
        setUserProfile(null);
        setBiometricLocked(false);
        setAuthReady(true);
        return;
      }
      await finalizeAuthenticatedSession(fbUser);
    });
    return () => {
      unsub();
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('message', handleSwMessage);
      }
    };
  }, []);

  // Attach Firestore real-time listeners strictly after auth, profile readiness & biometric unlock
  useEffect(() => {
    if (!authReady || !firebaseUser || !userProfile || biometricLocked || portalAccessError) {
      return;
    }

    setDataLoading(true);
    const orgId = userProfile.organizationId || DEFAULT_ORG_ID;
    const isExternal = userProfile.role === 'EXTERNAL_CLIENT' || portalMode === 'client';
    const isAdmin = userProfile.role === 'ADMIN';
    const superAdmin = isSuperAdminUser(userProfile, firebaseUser.emailVerified);
    const unsubs: Array<() => void> = [];

    const allOrgsQuery = collection(db, 'organizations');
    unsubs.push(
      onSnapshot(
        allOrgsQuery,
        (snap) => {
          if (!snap.empty) {
            const orgs = snap.docs.map((d) => {
              const rawData = d.data() as OrganizationRecord;
              const orgDocId = rawData.id || d.id;
              const raw: OrganizationRecord = {
                ...rawData,
                id: orgDocId,
                organizationId: rawData.organizationId || orgDocId,
              };
              const currentModules =
                Array.isArray(raw.enabledModules) && raw.enabledModules.length > 0
                  ? raw.enabledModules
                  : Array.isArray(raw.modulesEnabled) && raw.modulesEnabled.length > 0
                  ? raw.modulesEnabled
                  : [];
              const explicitlyDisabled =
                typeof window !== 'undefined' &&
                window.localStorage.getItem(`axycore_ecf_disabled_${orgDocId}`) === 'true';
              const explicitlyDisabledAltera =
                typeof window !== 'undefined' &&
                window.localStorage.getItem(`axycore_altera_disabled_${orgDocId}`) === 'true';
              const explicitlyDisabledRegula =
                typeof window !== 'undefined' &&
                window.localStorage.getItem(`axycore_regula_disabled_${orgDocId}`) === 'true';
              const hasAccountingOrFinance =
                currentModules.includes('contabilidad') || currentModules.includes('finanzas');
              const isEligibleTenant =
                orgDocId === DEFAULT_ORG_ID ||
                raw.planCode === 'CORPORATIVO' ||
                raw.planCode === 'EMPRESARIAL' ||
                hasAccountingOrFinance;
              const isEligibleAltera =
                orgDocId === DEFAULT_ORG_ID ||
                raw.planCode === 'CORPORATIVO' ||
                raw.planCode === 'EMPRESARIAL' ||
                currentModules.includes('motor_decisiones');
              const isEligibleRegula =
                orgDocId === DEFAULT_ORG_ID ||
                raw.planCode === 'CORPORATIVO' ||
                raw.planCode === 'EMPRESARIAL' ||
                currentModules.includes('clientes') ||
                currentModules.length > 0;
              const shouldAutoIncludeEcf =
                !explicitlyDisabled &&
                isEligibleTenant &&
                (!currentModules.includes('facturacion_electronica') ||
                  ((orgDocId === DEFAULT_ORG_ID || hasAccountingOrFinance) &&
                    !currentModules.includes('contabilidad')));
              const shouldAutoIncludeAltera =
                !explicitlyDisabledAltera &&
                isEligibleAltera &&
                !currentModules.includes('altera');
              const shouldAutoIncludeRegula =
                !explicitlyDisabledRegula &&
                isEligibleRegula &&
                !currentModules.includes('regula');
              if (!shouldAutoIncludeEcf && !shouldAutoIncludeAltera && !shouldAutoIncludeRegula) {
                return {
                  ...raw,
                  enabledModules: currentModules,
                  modulesEnabled: currentModules,
                };
              }
              const extraModules: AxyCoreModuleCode[] = [
                ...(shouldAutoIncludeEcf
                  ? hasAccountingOrFinance || orgDocId === DEFAULT_ORG_ID
                    ? (['contabilidad', 'facturacion_electronica'] as AxyCoreModuleCode[])
                    : (['facturacion_electronica'] as AxyCoreModuleCode[])
                  : []),
                ...(shouldAutoIncludeAltera ? (['altera'] as AxyCoreModuleCode[]) : []),
                ...(shouldAutoIncludeRegula ? (['regula'] as AxyCoreModuleCode[]) : []),
              ];
              const upgradedModules = Array.from(
                new Set([...currentModules, ...extraModules])
              ) as AxyCoreModuleCode[];
              return {
                ...raw,
                enabledModules: upgradedModules,
                modulesEnabled: upgradedModules,
              };
            });
            setAllOrganizations(orgs);
            fetch('/api/tenants/sync-directory', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                organizations: orgs.map((o) => ({
                  id: o.id,
                  tenantId: o.tenantId || o.tenant_id || o.id,
                  accessCode: o.accessCode || '',
                  name: o.name,
                  tradeName: o.tradeName || o.name,
                  status: o.status || 'ACTIVA',
                  planCode: o.planCode || 'EMPRESARIAL',
                })),
              }),
            }).catch(() => {});
            const activeOrg = orgs.find((o) => o.id === orgId);
            if (activeOrg) {
              setOrganization(activeOrg);
              tenantService.setContext({ organization: activeOrg, user: userProfile });
            }
          }
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'organizations')
      )
    );

    // Multi-tenant memberships, licenses & subscriptions
    const memQuery = superAdmin
      ? collection(db, 'organization_memberships')
      : isAdmin
      ? query(collection(db, 'organization_memberships'), where('organizationId', '==', orgId))
      : query(collection(db, 'organization_memberships'), where('userId', '==', userProfile.uid));
    unsubs.push(
      onSnapshot(
        memQuery,
        (snap) => setOrganizationMemberships(snap.docs.map((d) => d.data() as OrganizationMembershipRecord)),
        () => {}
      )
    );

    const licQuery = superAdmin
      ? collection(db, 'licenses')
      : query(collection(db, 'licenses'), where('organizationId', '==', orgId));
    unsubs.push(
      onSnapshot(
        licQuery,
        (snap) =>
          setTenantLicenses(
            snap.docs.map((d) => {
              const lic = d.data() as TenantLicenseRecord;
              const licOrgId = lic.organizationId || DEFAULT_ORG_ID;
              const disabledRegula =
                typeof window !== 'undefined' &&
                window.localStorage.getItem(`axycore_regula_disabled_${licOrgId}`) === 'true';
              const licModules = Array.isArray(lic.enabledModules) ? lic.enabledModules : [];
              const eligible =
                licOrgId === DEFAULT_ORG_ID ||
                lic.planCode === 'CORPORATIVO' ||
                lic.planCode === 'EMPRESARIAL' ||
                licModules.includes('clientes');
              if (!disabledRegula && eligible && !licModules.includes('regula')) {
                return {
                  ...lic,
                  enabledModules: [...licModules, 'regula'],
                };
              }
              return lic;
            })
          ),
        () => {}
      )
    );

    const subQuery = superAdmin
      ? collection(db, 'subscriptions')
      : query(collection(db, 'subscriptions'), where('organizationId', '==', orgId));
    unsubs.push(
      onSnapshot(
        subQuery,
        (snap) => setTenantSubscriptions(snap.docs.map((d) => d.data() as TenantSubscriptionRecord)),
        () => {}
      )
    );

    const polQuery = query(collection(db, 'credit_policies'), where('organizationId', '==', orgId));
    unsubs.push(
      onSnapshot(
        polQuery,
        (snap) => {
          if (!snap.empty) {
            setPolicies(snap.docs.map((d) => d.data() as CreditPolicyRecord));
          }
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'credit_policies')
      )
    );

    // Reset snapshot baseline when user/org subscription restarts
    hasInitialAppsSnapshotRef.current = false;
    knownAppStatusRef.current = new Map();

    // Load user-specific acknowledged notifications from localStorage
    if (!isExternal && typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(`axycore_ack_notifs_${userProfile.uid}`);
        setAcknowledgedKeys(raw ? (JSON.parse(raw) as string[]) : []);
      } catch {
        setAcknowledgedKeys([]);
      }
    } else {
      setAcknowledgedKeys([]);
    }

    // Applications, Customers, Documents, Scoring: External client queries strictly by own UID; Staff queries by organizationId
    const appQuery = isExternal
      ? query(collection(db, 'applications'), where('createdBy', '==', userProfile.uid))
      : query(collection(db, 'applications'), where('organizationId', '==', orgId));
    unsubs.push(
      onSnapshot(
        appQuery,
        (snap) => {
          const nextApps = snap.docs.map((d) => d.data() as ApplicationRecord);
          setApplications(nextApps);
          setDataLoading(false);
          setLastSyncedAtIso(new Date().toISOString());

          if (!hasInitialAppsSnapshotRef.current) {
            const initMap = new Map<string, string>();
            nextApps.forEach((a) => initMap.set(a.id, a.status));
            knownAppStatusRef.current = initMap;
            hasInitialAppsSnapshotRef.current = true;
          } else {
            const incomingAlerts: LiveToastAlert[] = [];
            const nowMs = Date.now();
            const trackedStatuses = pushSubscribedStatusesRef.current;

            snap.docChanges().forEach((change) => {
              if (change.type !== 'added' && change.type !== 'modified') return;
              const app = change.doc.data() as ApplicationRecord;
              const prevStatus = knownAppStatusRef.current.get(app.id);
              knownAppStatusRef.current.set(app.id, app.status);

              if (
                shouldTriggerApplicationCriticalPush(prevStatus, app.status) &&
                (trackedStatuses.length === 0 || trackedStatuses.includes(app.status))
              ) {
                const payload = buildApplicationCriticalPushPayload(app, {
                  prevStatus,
                  audience: isExternal ? 'CLIENT' : 'STAFF',
                });
                const lastTriggeredAt = recentAlertAckRef.current.get(payload.ackKey) ?? 0;
                if (nowMs - lastTriggeredAt < 10000) {
                  return;
                }
                recentAlertAckRef.current.set(payload.ackKey, nowMs);

                incomingAlerts.push({
                  toastId: `toast_${app.id}_${app.status}_${nowMs}`,
                  ackKey: payload.ackKey,
                  applicationId: app.id,
                  applicationNumber: app.applicationNumber,
                  applicantDisplayName: app.applicantDisplayName,
                  title: payload.title,
                  detail: payload.body,
                  channel: app.channel,
                  status: app.status,
                  createdAtIso: new Date().toISOString(),
                });

                if (desktopNotifEnabledRef.current) {
                  void sendClientWebPushNotification({
                    title: payload.title,
                    body: payload.body,
                    applicationId: app.id,
                    targetSection: payload.targetSection,
                    tag: payload.ackKey,
                  });
                }
              }
            });

            if (incomingAlerts.length > 0) {
              setLiveToasts((prev) => [...incomingAlerts, ...prev].slice(0, 6));
            }
          }
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'applications')
      )
    );

    const custQuery = isExternal
      ? query(collection(db, 'customers'), where('createdBy', '==', userProfile.uid))
      : query(collection(db, 'customers'), where('organizationId', '==', orgId));
    unsubs.push(
      onSnapshot(
        custQuery,
        (snap) => setCustomers(snap.docs.map((d) => d.data() as CustomerRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'customers')
      )
    );

    const bizQuery = isExternal
      ? query(collection(db, 'businesses'), where('createdBy', '==', userProfile.uid))
      : query(collection(db, 'businesses'), where('organizationId', '==', orgId));
    unsubs.push(
      onSnapshot(
        bizQuery,
        (snap) => setBusinesses(snap.docs.map((d) => d.data() as BusinessRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'businesses')
      )
    );

    const docQuery = isExternal
      ? query(collection(db, 'application_documents'), where('uploadedBy', '==', userProfile.uid))
      : query(collection(db, 'application_documents'), where('organizationId', '==', orgId));
    unsubs.push(
      onSnapshot(
        docQuery,
        (snap) => setDocuments(snap.docs.map((d) => d.data() as ApplicationDocumentRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'application_documents')
      )
    );

    const scoreQuery = isExternal
      ? query(collection(db, 'scoring_executions'), where('executedBy', '==', userProfile.uid))
      : query(collection(db, 'scoring_executions'), where('organizationId', '==', orgId));
    unsubs.push(
      onSnapshot(
        scoreQuery,
        (snap) => setScoringExecutions(snap.docs.map((d) => d.data() as ScoringExecutionRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'scoring_executions')
      )
    );

    const loansQuery = isExternal
      ? query(collection(db, 'loans'), where('createdBy', '==', userProfile.uid))
      : query(collection(db, 'loans'), where('organizationId', '==', orgId));
    unsubs.push(
      onSnapshot(
        loansQuery,
        (snap) => setLoans(snap.docs.map((d) => d.data() as LoanRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'loans')
      )
    );

    const emailQuery = isExternal
      ? query(collection(db, 'email_notifications'), where('applicantUid', '==', userProfile.uid))
      : query(collection(db, 'email_notifications'), where('organizationId', '==', orgId));
    unsubs.push(
      onSnapshot(
        emailQuery,
        (snap) => setEmailNotifications(snap.docs.map((d) => d.data() as EmailNotificationRecord)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'email_notifications')
      )
    );

    // Internal-only operational collections (NEVER subscribed for EXTERNAL_CLIENT)
    if (!isExternal) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'financial_analyses'), where('organizationId', '==', orgId)),
          (snap) => setFinancialAnalyses(snap.docs.map((d) => d.data() as FinancialAnalysisRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'financial_analyses')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'application_decision_history'), where('organizationId', '==', orgId)),
          (snap) =>
            setApplicationDecisionHistory(
              snap.docs.map((d) => d.data() as ApplicationDecisionHistoryRecord)
            ),
          (err) => handleFirestoreError(err, OperationType.LIST, 'application_decision_history')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'credit_evaluations'), where('organizationId', '==', orgId)),
          (snap) => setEvaluations(snap.docs.map((d) => d.data() as CreditEvaluationRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'credit_evaluations')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'committee_decisions'), where('organizationId', '==', orgId)),
          (snap) => setCommitteeDecisions(snap.docs.map((d) => d.data() as CommitteeDecisionRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'committee_decisions')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'formalizations'), where('organizationId', '==', orgId)),
          (snap) => setFormalizations(snap.docs.map((d) => d.data() as FormalizationRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'formalizations')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'disbursements'), where('organizationId', '==', orgId)),
          (snap) => setDisbursements(snap.docs.map((d) => d.data() as DisbursementRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'disbursements')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'audit_logs'), where('organizationId', '==', orgId)),
          (snap) => setAuditLogs(snap.docs.map((d) => d.data() as AuditLogRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'audit_logs')
        )
      );

      // Cobranza real-time subscriptions (single organizationId filter; sort/filter in memory)
      unsubs.push(
        onSnapshot(
          query(collection(db, 'loan_installments'), where('organizationId', '==', orgId)),
          (snap) => setLoanInstallments(snap.docs.map((d) => d.data() as LoanInstallmentRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'loan_installments')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'collection_accounts'), where('organizationId', '==', orgId)),
          (snap) => setCollectionAccounts(snap.docs.map((d) => d.data() as CollectionAccountRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'collection_accounts')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'collection_assignments'), where('organizationId', '==', orgId)),
          (snap) => setCollectionAssignments(snap.docs.map((d) => d.data() as CollectionAssignmentRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'collection_assignments')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'collection_actions'), where('organizationId', '==', orgId)),
          (snap) => setCollectionActions(snap.docs.map((d) => d.data() as CollectionActionRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'collection_actions')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'collection_tasks'), where('organizationId', '==', orgId)),
          (snap) => setCollectionTasks(snap.docs.map((d) => d.data() as CollectionTaskRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'collection_tasks')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'payment_promises'), where('organizationId', '==', orgId)),
          (snap) => setPaymentPromises(snap.docs.map((d) => d.data() as PaymentPromiseRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'payment_promises')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'payment_agreements'), where('organizationId', '==', orgId)),
          (snap) => setPaymentAgreements(snap.docs.map((d) => d.data() as PaymentAgreementRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'payment_agreements')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'payments'), where('organizationId', '==', orgId)),
          (snap) => setPayments(snap.docs.map((d) => d.data() as PaymentRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'payments')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'payment_allocations'), where('organizationId', '==', orgId)),
          (snap) => setPaymentAllocations(snap.docs.map((d) => d.data() as PaymentAllocationRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'payment_allocations')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'payment_reversals'), where('organizationId', '==', orgId)),
          (snap) => setPaymentReversals(snap.docs.map((d) => d.data() as PaymentReversalRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'payment_reversals')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'collection_receipts'), where('organizationId', '==', orgId)),
          (snap) => setCollectionReceipts(snap.docs.map((d) => d.data() as CollectionReceiptRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'collection_receipts')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'payment_intents'), where('organizationId', '==', orgId)),
          (snap) => setPaymentIntents(snap.docs.map((d) => d.data() as PaymentIntentRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'payment_intents')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'bank_transactions'), where('organizationId', '==', orgId)),
          (snap) => setBankTransactions(snap.docs.map((d) => d.data() as BankTransactionRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'bank_transactions')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'reconciliation_matches'), where('organizationId', '==', orgId)),
          (snap) => setReconciliationMatches(snap.docs.map((d) => d.data() as ReconciliationMatchRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'reconciliation_matches')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'reconciliation_exceptions'), where('organizationId', '==', orgId)),
          (snap) => setReconciliationExceptions(snap.docs.map((d) => d.data() as ReconciliationExceptionRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'reconciliation_exceptions')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'collector_targets'), where('organizationId', '==', orgId)),
          (snap) => setCollectorTargets(snap.docs.map((d) => d.data() as CollectorTargetRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'collector_targets')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'collection_campaigns'), where('organizationId', '==', orgId)),
          (snap) => setCollectionCampaigns(snap.docs.map((d) => d.data() as CollectionCampaignRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'collection_campaigns')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'message_templates'), where('organizationId', '==', orgId)),
          (snap) => setMessageTemplates(snap.docs.map((d) => d.data() as MessageTemplateRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'message_templates')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'message_events'), where('organizationId', '==', orgId)),
          (snap) => setMessageEvents(snap.docs.map((d) => d.data() as MessageEventRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'message_events')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'risk_alerts'), where('organizationId', '==', orgId)),
          (snap) => setRiskAlerts(snap.docs.map((d) => d.data() as RiskAlertRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'risk_alerts')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'customer_disputes'), where('organizationId', '==', orgId)),
          (snap) => setCustomerDisputes(snap.docs.map((d) => d.data() as CustomerDisputeRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'customer_disputes')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'collection_policy_versions'), where('organizationId', '==', orgId)),
          (snap) => {
            if (!snap.empty) {
              setCollectionPolicies(snap.docs.map((d) => d.data() as CollectionPolicyVersionRecord));
            }
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'collection_policy_versions')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'collection_daily_snapshots'), where('organizationId', '==', orgId)),
          (snap) => setCollectionDailySnapshots(snap.docs.map((d) => d.data() as CollectionDailySnapshotRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'collection_daily_snapshots')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'operating_expenses'), where('organizationId', '==', orgId)),
          (snap) => setOperatingExpenses(snap.docs.map((d) => d.data() as OperatingExpenseRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'operating_expenses')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'investors'), where('organizationId', '==', orgId)),
          (snap) => setInvestors(snap.docs.map((d) => d.data() as InvestorRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'investors')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'investor_transactions'), where('organizationId', '==', orgId)),
          (snap) => setInvestorTransactions(snap.docs.map((d) => d.data() as InvestorTransactionRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'investor_transactions')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'accounting_accounts'), where('organizationId', '==', orgId)),
          (snap) => setAccountingAccounts(snap.docs.map((d) => d.data() as AccountingAccountRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'accounting_accounts')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'accounting_journal_entries'), where('organizationId', '==', orgId)),
          (snap) => setJournalEntries(snap.docs.map((d) => d.data() as JournalEntryRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'accounting_journal_entries')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'dgii_fiscal_configs'), where('organizationId', '==', orgId)),
          (snap) => setDgiiFiscalConfigs(snap.docs.map((d) => d.data() as DgiiFiscalConfigRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'dgii_fiscal_configs')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'dgii_certificates'), where('organizationId', '==', orgId)),
          (snap) => setDgiiCertificates(snap.docs.map((d) => d.data() as DgiiCertificateRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'dgii_certificates')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'dgii_encf_sequences'), where('organizationId', '==', orgId)),
          (snap) => setDgiiSequences(snap.docs.map((d) => d.data() as DgiiEncfSequenceRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'dgii_encf_sequences')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'dgii_receivers'), where('organizationId', '==', orgId)),
          (snap) => setDgiiReceivers(snap.docs.map((d) => d.data() as DgiiReceiverRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'dgii_receivers')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'dgii_products'), where('organizationId', '==', orgId)),
          (snap) => setDgiiProducts(snap.docs.map((d) => d.data() as DgiiProductRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'dgii_products')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'dgii_ecf_documents'), where('organizationId', '==', orgId)),
          (snap) => setDgiiEcfDocuments(snap.docs.map((d) => d.data() as DgiiEcfDocumentRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'dgii_ecf_documents')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'dgii_audit_logs'), where('organizationId', '==', orgId)),
          (snap) => setDgiiAuditLogs(snap.docs.map((d) => d.data() as DgiiAuditLogRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'dgii_audit_logs')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'altera_scenarios'), where('organizationId', '==', orgId)),
          (snap) => setAlteraScenarios(snap.docs.map((d) => d.data() as AlteraSavedScenarioRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'altera_scenarios')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'altera_recommendations'), where('organizationId', '==', orgId)),
          (snap) =>
            setAlteraRecommendations(snap.docs.map((d) => d.data() as AlteraRecommendationRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'altera_recommendations')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'altera_outcomes'), where('organizationId', '==', orgId)),
          (snap) => setAlteraOutcomes(snap.docs.map((d) => d.data() as AlteraOutcomeRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'altera_outcomes')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'altera_analyses'), where('organizationId', '==', orgId)),
          (snap) => setAlteraAnalyses(snap.docs.map((d) => d.data() as AlteraAnalysisLogRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'altera_analyses')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'altera_configs'), where('organizationId', '==', orgId)),
          (snap) => setAlteraConfigs(snap.docs.map((d) => d.data() as AlteraConfigRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'altera_configs')
        )
      );
    }

    // Suscripciones Web Push VAPID (para staff interno y clientes externos)
    const pushSubQuery =
      !isExternal && isAdmin
        ? query(collection(db, 'push_subscriptions'), where('organizationId', '==', orgId))
        : query(collection(db, 'push_subscriptions'), where('userId', '==', userProfile.uid));
    unsubs.push(
      onSnapshot(
        pushSubQuery,
        (snap) => setPushSubscriptions(snap.docs.map((d) => d.data() as PushSubscriptionRecord)),
        () => {}
      )
    );

    if (!isExternal) {
      const fcmQuery = isAdmin
        ? query(collection(db, 'fcm_tokens'), where('organizationId', '==', orgId))
        : query(
            collection(db, 'fcm_tokens'),
            where('organizationId', '==', orgId),
            where('userId', '==', userProfile.uid)
          );
      unsubs.push(
        onSnapshot(
          fcmQuery,
          (snap) => setFcmDeviceTokens(snap.docs.map((d) => d.data() as FcmDeviceTokenRecord)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'fcm_tokens')
        )
      );
    } else {
      // Cliente Externo / Portal de Clientes escucha sus propios pagos reportados en tiempo real
      unsubs.push(
        onSnapshot(
          query(collection(db, 'payments'), where('reportedByUserId', '==', userProfile.uid)),
          (snap) => setPayments(snap.docs.map((d) => d.data() as PaymentRecord)),
          () => {}
        )
      );
      setFcmDeviceTokens([]);
    }

    if (isAdmin || superAdmin) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'users'), where('organizationId', '==', orgId)),
          (snap) => setUsersList(snap.docs.map((d) => d.data() as UserProfile)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'users')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'user_invitations'), where('organizationId', '==', orgId)),
          (snap) => setUserInvitations(snap.docs.map((d) => d.data() as UserInvitationRecord)),
          () => {}
        )
      );
    } else {
      setUserInvitations([]);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [authReady, firebaseUser, userProfile, biometricLocked, portalAccessError, portalMode]);

  const activeDgiiConfig = useMemo(
    () => getEffectiveDgiiConfig(dgiiFiscalConfigs, organization),
    [dgiiFiscalConfigs, organization]
  );

  const alteraConfig = useMemo<AlteraConfigRecord>(() => {
    const orgId = organization.id || organization.organizationId || DEFAULT_ORG_ID;
    const found = alteraConfigs.find((c) => c.organizationId === orgId);
    return found || buildDefaultAlteraConfig(orgId);
  }, [alteraConfigs, organization.id, organization.organizationId]);

  const saveAlteraScenarioEntry = useCallback(
    async (
      scenario: Omit<
        AlteraSavedScenarioRecord,
        'id' | 'organizationId' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'
      >
    ) => {
      if (!userProfile) throw new Error('Sesión requerida para guardar escenarios en ALTERA.');
      return saveAlteraScenario({ user: userProfile, scenario });
    },
    [userProfile]
  );

  const createAlteraRecommendationEntry = useCallback(
    async (params: {
      initialStatus?: 'GENERADA' | 'PENDIENTE_REVISION';
      recommendation: Omit<
        AlteraRecommendationRecord,
        | 'id'
        | 'organizationId'
        | 'code'
        | 'createdAtIso'
        | 'status'
        | 'followUpHistory'
        | 'createdBy'
        | 'createdByName'
        | 'createdAt'
        | 'updatedAt'
      >;
      initialNotes?: string;
    }) => {
      if (!userProfile) throw new Error('Sesión requerida para crear recomendaciones en ALTERA.');
      return createAlteraRecommendation({
        user: userProfile,
        initialStatus: params.initialStatus,
        recommendation: params.recommendation,
        initialNotes: params.initialNotes,
      });
    },
    [userProfile]
  );

  const updateAlteraRecommendationStatus = useCallback(
    async (params: {
      recommendation: AlteraRecommendationRecord;
      nextStatus: AlteraRecommendationStatus;
      notes?: string;
    }) => {
      if (!userProfile) throw new Error('Sesión requerida para actualizar recomendaciones ALTERA.');
      return transitionAlteraRecommendationStatus({
        user: userProfile,
        recommendation: params.recommendation,
        nextStatus: params.nextStatus,
        notes: params.notes,
      });
    },
    [userProfile]
  );

  const recordAlteraOutcomeCalibration = useCallback(
    async (
      outcome: Omit<
        AlteraOutcomeRecord,
        'id' | 'organizationId' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'
      >
    ) => {
      if (!userProfile) throw new Error('Sesión requerida para calibrar resultados ALTERA.');
      return saveAlteraOutcomeCalibration({ user: userProfile, outcome });
    },
    [userProfile]
  );

  const logAlteraAnalysis = useCallback(
    async (
      entry: Omit<
        AlteraAnalysisLogRecord,
        'id' | 'organizationId' | 'actorUid' | 'actorName' | 'actorRole' | 'createdAtIso' | 'createdAt'
      >
    ) => {
      if (!userProfile) return null;
      return logAlteraAnalysisHistory({ user: userProfile, entry });
    },
    [userProfile]
  );

  const updateAlteraConfigSettings = useCallback(
    async (
      config: Partial<
        Omit<
          AlteraConfigRecord,
          | 'id'
          | 'organizationId'
          | 'requireHumanApprovalForAllInterventions'
          | 'updatedBy'
          | 'updatedByName'
          | 'createdAt'
          | 'updatedAt'
        >
      >
    ) => {
      if (!userProfile) throw new Error('Sesión requerida para configurar ALTERA.');
      return saveAlteraConfig({ user: userProfile, config, existingConfig: alteraConfig });
    },
    [userProfile, alteraConfig]
  );

  const activeOrTestPolicy = useMemo(() => {
    const active = policies.find((p) => p.status === 'ACTIVA');
    if (active) return active;
    const testing = policies.find((p) => p.status === 'EN_PRUEBAS' || p.status === 'PROPUESTA');
    return testing ?? FALLBACK_POLICY;
  }, [policies]);

  const ackSet = useMemo(() => new Set(acknowledgedKeys), [acknowledgedKeys]);

  const inboxAlerts = useMemo<InboxAlertItem[]>(() => {
    if (!userProfile || userProfile.role === 'EXTERNAL_CLIENT') return [];
    const actionable = applications.filter((a) =>
      ['RECIBIDA', 'DEVUELTA', 'EN_COMITE'].includes(a.status)
    );

    const priorityWeight = (a: ApplicationRecord) => {
      if (a.status === 'RECIBIDA' && a.channel === 'EXTERNAL') return 4;
      if (a.status === 'RECIBIDA') return 3;
      if (a.status === 'DEVUELTA') return 2;
      return 1;
    };

    return actionable
      .sort((a, b) => {
        const diff = priorityWeight(b) - priorityWeight(a);
        if (diff !== 0) return diff;
        return b.applicationNumber.localeCompare(a.applicationNumber);
      })
      .map((app) => {
        const ackKey = `${app.id}:${app.status}`;
        const priority: 'INMEDIATA' | 'ALTA' =
          app.status === 'RECIBIDA' || app.status === 'DEVUELTA' ? 'INMEDIATA' : 'ALTA';
        const reason =
          app.status === 'RECIBIDA'
            ? app.channel === 'EXTERNAL'
              ? 'Solicitud nueva de canal externo pendiente de evaluación'
              : 'Nueva solicitud recibida pendiente de inicio'
            : app.status === 'DEVUELTA'
            ? 'Expediente devuelto pendiente de atención'
            : 'Expediente en Comité pendiente de decisión';
        return {
          ackKey,
          application: app,
          priority,
          reason,
          isUnread: !ackSet.has(ackKey),
        };
      });
  }, [applications, userProfile, ackSet]);

  const unreadAlertCount = useMemo(
    () => inboxAlerts.filter((a) => a.isUnread).length,
    [inboxAlerts]
  );

  const persistAckKeys = useCallback(
    (nextKeys: string[]) => {
      setAcknowledgedKeys(nextKeys);
      if (userProfile && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(
            `axycore_ack_notifs_${userProfile.uid}`,
            JSON.stringify(nextKeys.slice(-200))
          );
        } catch {
          // Ignore storage quota issues
        }
      }
    },
    [userProfile]
  );

  const acknowledgeAlert = useCallback(
    (ackKey: string) => {
      if (ackSet.has(ackKey)) return;
      persistAckKeys([...acknowledgedKeys, ackKey]);
    },
    [ackSet, acknowledgedKeys, persistAckKeys]
  );

  const acknowledgeAllAlerts = useCallback(() => {
    const merged = Array.from(new Set([...acknowledgedKeys, ...inboxAlerts.map((a) => a.ackKey)]));
    persistAckKeys(merged);
  }, [acknowledgedKeys, inboxAlerts, persistAckKeys]);

  const dismissLiveToast = useCallback((toastId: string) => {
    setLiveToasts((prev) => prev.filter((t) => t.toastId !== toastId));
  }, []);

  const requestDesktopNotifications = useCallback(async (): Promise<DesktopNotificationPermission> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setDesktopNotifPermission('unsupported');
      return 'unsupported';
    }
    try {
      const perm = (await window.Notification.requestPermission()) as DesktopNotificationPermission;
      setDesktopNotifPermission(perm);
      if (perm === 'granted') {
        setDesktopNotifEnabled(true);
        window.localStorage.setItem('axycore_desktop_notif', 'true');
      }
      return perm;
    } catch {
      return desktopNotifPermission;
    }
  }, [desktopNotifPermission]);

  const toggleDesktopNotifications = useCallback(() => {
    setDesktopNotifEnabled((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('axycore_desktop_notif', next ? 'true' : 'false');
      }
      return next;
    });
  }, []);

  const enableFcmPush = useCallback(async () => {
    if (!userProfile) return;
    setFcmStatus('registering');
    setFcmError(null);

    const res = await subscribeBrowserToVapidPush({ user: userProfile });
    setFcmStatus(res.status);
    if (res.status !== 'active' || !res.subscription || !res.subscriptionId) {
      setFcmError(res.message ?? null);
      if (res.status === 'permission_denied') {
        setDesktopNotifPermission('denied');
      }
      return;
    }

    setPushSubscriptionId(res.subscriptionId);
    setPushEndpoint(res.subscription.endpoint);
    setPushDeliveryMode(res.deliveryMode ?? 'WEB_PUSH_VAPID');
    setFcmToken(res.fcmToken ?? null);
    setDesktopNotifPermission('granted');
    setDesktopNotifEnabled(true);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('axycore_desktop_notif', 'true');
      window.localStorage.removeItem(`axycore_fcm_opt_out_${userProfile.uid}`);
    }

    try {
      await savePushSubscriptionRecord({
        user: userProfile,
        endpoint: res.subscription.endpoint,
        p256dh: res.subscription.p256dh,
        auth: res.subscription.auth,
        fcmToken: res.fcmToken ?? null,
        vapidPublicKeyPrefix: res.vapidPublicKeyPrefix || 'vapid',
        subscribedStatuses: pushSubscribedStatusesRef.current,
      });

      if (res.fcmToken && userProfile.role !== 'EXTERNAL_CLIENT') {
        await saveFcmDeviceToken({ user: userProfile, token: res.fcmToken }).catch(() => {});
      }

      await registerPushSubscriptionWithServer({
        subscriptionId: res.subscriptionId,
        user: userProfile,
        subscription: res.subscription,
        fcmToken: res.fcmToken ?? null,
        subscribedStatuses: pushSubscribedStatusesRef.current,
      });
    } catch (err) {
      setFcmStatus('error');
      setFcmError(
        err instanceof Error ? err.message : 'Error guardando la suscripción Push en Firestore.'
      );
    }
  }, [userProfile]);

  const disableFcmPush = useCallback(async () => {
    if (!userProfile) return;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`axycore_fcm_opt_out_${userProfile.uid}`, 'true');
    }
    const { endpoint: browserEndpoint } = await unsubscribeBrowserFromVapidPush();
    const effectiveEndpoint = browserEndpoint || pushEndpoint;

    if (pushSubscriptionId || effectiveEndpoint) {
      await revokePushSubscriptionRecord({
        userId: userProfile.uid,
        subscriptionId: pushSubscriptionId,
        endpoint: effectiveEndpoint,
      }).catch(() => {});
      await unregisterPushSubscriptionFromServer({
        userId: userProfile.uid,
        subscriptionId: pushSubscriptionId,
        endpoint: effectiveEndpoint,
      });
    }
    if (fcmToken && userProfile.role !== 'EXTERNAL_CLIENT') {
      await revokeFcmDeviceToken({ userId: userProfile.uid, token: fcmToken }).catch(() => {});
    }
    setFcmToken(null);
    setPushSubscriptionId(null);
    setPushEndpoint(null);
    setPushDeliveryMode(null);
    setFcmStatus('idle');
    setFcmError(null);
  }, [userProfile, fcmToken, pushEndpoint, pushSubscriptionId]);

  const updatePushStatusPreferences = useCallback(
    async (statuses: ApplicationRecord['status'][]) => {
      const next: ApplicationRecord['status'][] =
        statuses.length > 0 ? statuses : [...ALL_TRACKED_PUSH_STATUSES];
      setPushSubscribedStatuses(next);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('axycore_push_statuses', JSON.stringify(next));
      }
      if (pushSubscriptionId) {
        await updatePushSubscriptionPreferences({
          subscriptionId: pushSubscriptionId,
          subscribedStatuses: next,
        }).catch(() => {});
      }
      if (userProfile && pushSubscriptionId && pushEndpoint) {
        const currentRecord = pushSubscriptions.find((s) => s.id === pushSubscriptionId);
        if (currentRecord) {
          await registerPushSubscriptionWithServer({
            subscriptionId: pushSubscriptionId,
            user: userProfile,
            subscription: {
              endpoint: currentRecord.endpoint,
              p256dh: currentRecord.p256dh,
              auth: currentRecord.auth,
            },
            fcmToken: currentRecord.fcmToken ?? fcmToken,
            subscribedStatuses: next,
          }).catch(() => {});
        }
      }
    },
    [pushSubscriptionId, pushEndpoint, pushSubscriptions, userProfile, fcmToken]
  );

  const sendTestPush = useCallback(async () => {
    if (!userProfile) return { delivered: false, channel: 'FAILED' };
    return sendTestPushViaServerOrLocal({
      user: userProfile,
      endpoint: pushEndpoint,
    });
  }, [userProfile, pushEndpoint]);

  // Initialize VAPID Web Push subscription, FCM foreground listener, and SSE relay for ALL users (staff & clients)
  useEffect(() => {
    if (!userProfile) {
      setFcmStatus('idle');
      setFcmToken(null);
      setPushSubscriptionId(null);
      setPushEndpoint(null);
      setPushDeliveryMode(null);
      return;
    }

    let cancelled = false;
    let unsubForeground: (() => void) | null = null;
    let eventSource: EventSource | null = null;

    (async () => {
      const supported = isVapidWebPushSupported();
      if (cancelled) return;
      if (!supported) {
        setFcmStatus('unsupported');
        return;
      }

      const resolvedKey = await resolveVapidPublicKey();
      if (cancelled) return;
      if (!resolvedKey) {
        setFcmStatus('vapid_missing');
        setFcmVapidConfigured(false);
        return;
      }
      setFcmVapidConfigured(true);

      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (window.Notification.permission === 'denied') {
          setFcmStatus('permission_denied');
          return;
        }
        const optedOut = window.localStorage.getItem(`axycore_fcm_opt_out_${userProfile.uid}`) === 'true';
        if (window.Notification.permission === 'granted' && !optedOut) {
          const res = await subscribeBrowserToVapidPush({
            user: userProfile,
            vapidPublicKeyOverride: resolvedKey,
          });
          if (cancelled) return;
          setFcmStatus(res.status);
          if (res.status === 'active' && res.subscription && res.subscriptionId) {
            setPushSubscriptionId(res.subscriptionId);
            setPushEndpoint(res.subscription.endpoint);
            setPushDeliveryMode(res.deliveryMode ?? 'WEB_PUSH_VAPID');
            setFcmToken(res.fcmToken ?? null);

            await savePushSubscriptionRecord({
              user: userProfile,
              endpoint: res.subscription.endpoint,
              p256dh: res.subscription.p256dh,
              auth: res.subscription.auth,
              fcmToken: res.fcmToken ?? null,
              vapidPublicKeyPrefix: res.vapidPublicKeyPrefix || resolvedKey.slice(0, 16),
              subscribedStatuses: pushSubscribedStatusesRef.current,
            }).catch(() => {});

            if (res.fcmToken && userProfile.role !== 'EXTERNAL_CLIENT') {
              await saveFcmDeviceToken({ user: userProfile, token: res.fcmToken }).catch(() => {});
            }

            await registerPushSubscriptionWithServer({
              subscriptionId: res.subscriptionId,
              user: userProfile,
              subscription: res.subscription,
              fcmToken: res.fcmToken ?? null,
              subscribedStatuses: pushSubscribedStatusesRef.current,
            }).catch(() => {});
          } else if (res.message) {
            setFcmError(res.message);
          }
        }
      }

      // Connect SSE relay for instant cross-tab / cross-session status-change push delivery
      if (typeof window !== 'undefined' && 'EventSource' in window) {
        const sseUrl = `/api/push/events?organizationId=${encodeURIComponent(
          userProfile.organizationId || DEFAULT_ORG_ID
        )}&userId=${encodeURIComponent(userProfile.uid)}&userRole=${encodeURIComponent(
          userProfile.role
        )}`;
        eventSource = new window.EventSource(sseUrl);
        eventSource.addEventListener('credit_status_change', (ev) => {
          try {
            const parsed = JSON.parse((ev as MessageEvent).data) as {
              ackKey?: string;
              applicationId?: string;
              title?: string;
              body?: string;
              targetSection?: string;
              status?: ApplicationRecord['status'];
              data?: Record<string, string>;
            };
            const data = parsed.data ?? {};
            const applicationId = String(parsed.applicationId || data.applicationId || '');
            const status = (parsed.status || data.status || 'RECIBIDA') as ApplicationRecord['status'];
            const ackKey = String(parsed.ackKey || data.ackKey || `${applicationId}:${status}`);
            const trackedStatuses = pushSubscribedStatusesRef.current;
            if (trackedStatuses.length > 0 && !trackedStatuses.includes(status)) return;

            const nowMs = Date.now();
            const lastSeen = recentAlertAckRef.current.get(ackKey) ?? 0;
            if (nowMs - lastSeen < 10000) return;
            recentAlertAckRef.current.set(ackKey, nowMs);

            const title = parsed.title || data.title || 'Cambio de estado de solicitud';
            const body = parsed.body || data.body || '';
            const targetSection = parsed.targetSection || data.targetSection || 'applications';

            if (applicationId) {
              setLiveToasts((prev) =>
                [
                  {
                    toastId: `push_${applicationId}_${nowMs}`,
                    ackKey,
                    applicationId,
                    applicationNumber: String(data.applicationNumber || 'Solicitud'),
                    applicantDisplayName: String(data.applicantDisplayName || 'Cliente'),
                    title,
                    detail: body,
                    channel: (data.channel || 'INTERNAL') as ApplicationRecord['channel'],
                    status,
                    createdAtIso: new Date().toISOString(),
                  },
                  ...prev,
                ].slice(0, 6)
              );
            }

            if (desktopNotifEnabledRef.current) {
              void sendClientWebPushNotification({
                title,
                body,
                applicationId,
                targetSection,
                tag: ackKey,
              });
            }
          } catch {
            // Ignore malformed SSE event
          }
        });
      }

      unsubForeground = await subscribeForegroundFcmMessages((payload) => {
        const data = payload.data ?? {};
        const applicationId = String(data.applicationId || '');
        const applicationNumber = String(data.applicationNumber || 'Solicitud');
        const applicantDisplayName = String(data.applicantDisplayName || 'Cliente');
        const status = (data.status || 'RECIBIDA') as ApplicationRecord['status'];
        const channel = (data.channel || 'INTERNAL') as ApplicationRecord['channel'];
        const ackKey = String(data.ackKey || `${applicationId}:${status}`);
        const nowMs = Date.now();
        const lastSeen = recentAlertAckRef.current.get(ackKey) ?? 0;

        if (nowMs - lastSeen < 10000) {
          return;
        }
        recentAlertAckRef.current.set(ackKey, nowMs);

        const title =
          payload.notification?.title || data.title || 'Actualización de solicitud de crédito';
        const body =
          payload.notification?.body || data.body || `${applicationNumber} · ${applicantDisplayName}`;

        if (applicationId) {
          setLiveToasts((prev) =>
            [
              {
                toastId: `fcm_${applicationId}_${nowMs}`,
                ackKey,
                applicationId,
                applicationNumber,
                applicantDisplayName,
                title,
                detail: body,
                channel,
                status,
                createdAtIso: new Date().toISOString(),
              },
              ...prev,
            ].slice(0, 6)
          );
        }
      });
    })();

    return () => {
      cancelled = true;
      if (unsubForeground) unsubForeground();
      if (eventSource) eventSource.close();
    };
  }, [userProfile]);

  const fcmActiveDevicesCount = useMemo(() => {
    const activePushSubs = pushSubscriptions.filter((s) => s.status === 'ACTIVE');
    const activeFcmTokens = fcmDeviceTokens.filter((t) => t.status === 'ACTIVE');
    if (activePushSubs.length > 0) {
      return activePushSubs.length;
    }
    return activeFcmTokens.length;
  }, [pushSubscriptions, fcmDeviceTokens]);

  const isSuperAdmin = useMemo(
    () => isSuperAdminUser(userProfile, firebaseUser?.emailVerified ?? true),
    [userProfile, firebaseUser]
  );

  // SuperAdmin (`andrygallardo7@gmail.com`) always retains access to Platform Control SaaS as well as Corporate and Client portals
  const isPlatformAdminPortal = isSuperAdmin;

  const availableWorkspaces = useMemo<OrganizationRecord[]>(() => {
    if (!userProfile) return [organization];
    if (isSuperAdmin) {
      const list = allOrganizations.length > 0 ? [...allOrganizations] : [organization];
      // Keep Su Gloria Mano Amiga first for quick corporate switching
      list.sort((a, b) => {
        if (a.id === DEFAULT_ORG_ID) return -1;
        if (b.id === DEFAULT_ORG_ID) return 1;
        return (a.tradeName || a.name).localeCompare(b.tradeName || b.name);
      });
      return list;
    }
    const myOrgIds = new Set<string>([userProfile.organizationId || DEFAULT_ORG_ID]);
    organizationMemberships.forEach((m) => {
      if (m.userId === userProfile.uid && m.status === 'ACTIVE') {
        myOrgIds.add(m.organizationId);
      }
    });
    const filtered = allOrganizations.filter((o) => myOrgIds.has(o.id));
    return filtered.length > 0 ? filtered : [organization];
  }, [userProfile, isSuperAdmin, allOrganizations, organizationMemberships, organization]);

  const getSectionTenantAccess = useCallback(
    (section: NavSectionId) => {
      return checkTenantSectionAccess({
        section,
        organization,
        isSuperAdmin,
      });
    },
    [organization, isSuperAdmin]
  );

  const switchOrganizationWorkspace = useCallback(
    async (targetOrganizationId: string) => {
      if (!userProfile) return;
      const updatedProfile = await switchActiveOrganizationInStore({
        user: userProfile,
        targetOrganizationId,
        organizations: allOrganizations.length > 0 ? allOrganizations : [organization],
        memberships: organizationMemberships,
        isSuperAdmin,
      });
      setUserProfile(updatedProfile);
      const nextOrg = allOrganizations.find((o) => o.id === targetOrganizationId);
      if (nextOrg) {
        setOrganization(nextOrg);
      }
      tenantService.setContext({
        user: updatedProfile,
        organization: nextOrg,
        tenantId: nextOrg?.tenantId || targetOrganizationId,
        organizationId: targetOrganizationId,
      });
      setDirectorAnalysis(null);
      setSelectedApplicationId(null);
      setSelectedCollectionLoanId(null);
    },
    [userProfile, allOrganizations, organization, organizationMemberships, isSuperAdmin]
  );

  const switchPortalMode = useCallback(
    async (nextMode: PortalAccessMode, targetOrganizationId?: string) => {
      setPortalAccessError(null);
      if (nextMode === 'axycore_admin') {
        if (!isSuperAdmin) return;
        setPortalMode('axycore_admin');
        setExternalPortalMode(false);
        setActiveSection('platform_control');
        return;
      }

      if (nextMode === 'client') {
        setPortalMode('client');
        setExternalPortalMode(true);
        setActiveSection('loans');
        return;
      }

      // Corporate portal
      setPortalMode('corporate');
      setExternalPortalMode(false);
      const desiredOrgId = targetOrganizationId || (isSuperAdmin ? DEFAULT_ORG_ID : userProfile?.organizationId || DEFAULT_ORG_ID);
      if (userProfile && desiredOrgId && userProfile.organizationId !== desiredOrgId) {
        try {
          await switchOrganizationWorkspace(desiredOrgId);
        } catch (err) {
          console.warn('No se pudo cambiar de organización al entrar al portal corporativo:', err);
        }
      }
      setActiveSection('dashboard');
    },
    [isSuperAdmin, setPortalMode, userProfile, switchOrganizationWorkspace]
  );

  const rbac = useMemo<AxyCoreRbacContext>(() => {
    const active = Boolean(userProfile && userProfile.status === 'ACTIVE');
    const role: UserRole = userProfile?.role ?? 'EXTERNAL_CLIENT';
    const profileMeta = CREDIT_ROLE_PROFILES[role];
    const baseRoleSections = active ? SECTION_ACCESS_BY_ROLE[role] ?? [] : [];
    const allowedSections: NavSectionId[] = [
      ...(isPlatformAdminPortal ? (['platform_control'] as NavSectionId[]) : []),
      ...baseRoleSections.filter((sec) => getSectionTenantAccess(sec).allowed),
    ];

    const permissions = active
      ? ROLE_PERMISSION_MATRIX[role]
      : ALL_CREDIT_PERMISSIONS.reduce((acc, p) => {
          acc[p] = false;
          return acc;
        }, {} as Record<CreditPermission, boolean>);

    return {
      role,
      roleLabel: isPlatformAdminPortal ? 'Superadministrador AxyCore' : profileMeta.label,
      roleSummary: profileMeta.scopeSummary,
      workflowFocus: profileMeta.workflowFocus,
      isInternalStaff: Boolean(active && role !== 'EXTERNAL_CLIENT'),
      isReadOnlyAuditor: role === 'AUDITOR',
      permissions,
      hasPermission: (permission: CreditPermission) =>
        Boolean(active && hasRolePermission(role, permission)),
      canAccessSection: (section: NavSectionId) => {
        if (!active) return false;
        if (section === 'platform_control') return isPlatformAdminPortal;
        return canRoleAccessSection(role, section) && getSectionTenantAccess(section).allowed;
      },
      allowedSections,
      getWorkflowAccess: ({ application, evaluation, proposedAmount }) =>
        getCreditWorkflowAccess({
          userProfile,
          application,
          evaluation,
          policy: activeOrTestPolicy,
          proposedAmount,
        }),
    };
  }, [userProfile, activeOrTestPolicy, isPlatformAdminPortal, getSectionTenantAccess]);

  const guardedSetActiveSection = useCallback(
    (section: NavSectionId) => {
      if (!userProfile) {
        setActiveSection(section);
        return;
      }
      if (section === 'platform_control') {
        if (isPlatformAdminPortal) {
          setActiveSection('platform_control');
        }
        return;
      }
      // Allow setting section if the user's role permits it so that if the tenant module is disabled, App.tsx can display the explicit "Módulo no contratado" screen
      if (canRoleAccessSection(userProfile.role, section) || rbac.canAccessSection(section)) {
        setActiveSection(section);
      } else if (rbac.allowedSections.length > 0) {
        setActiveSection(rbac.allowedSections[0]);
      }
    },
    [userProfile, rbac, isPlatformAdminPortal]
  );

  useEffect(() => {
    if (!userProfile || rbac.allowedSections.length === 0) return;

    if (intendedSection) {
      const target = rbac.canAccessSection(intendedSection)
        ? intendedSection
        : rbac.role === 'EXTERNAL_CLIENT'
        ? 'new_application'
        : 'dashboard';
      setActiveSection(target);
      setIntendedSection(null);
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem('axycore_intended_section');
      }
      return;
    }

    if (
      !rbac.canAccessSection(activeSection) &&
      !canRoleAccessSection(userProfile.role, activeSection)
    ) {
      setActiveSection(
        rbac.role === 'EXTERNAL_CLIENT' ? 'new_application' : rbac.allowedSections[0]
      );
    }
  }, [userProfile, activeSection, rbac, intendedSection]);

  const resolveCorporateAccessCode = useCallback(
    async (rawCode: string): Promise<{
      ok: boolean;
      organization?: ResolvedCorporateOrgInfo;
      error?: string;
    }> => {
      const clean = rawCode.trim();
      if (!clean) {
        return { ok: false, error: 'Ingresa el código único asignado a tu empresa.' };
      }

      // 1. Check in-memory loaded organizations first (e.g. when already cached or Su Gloria default)
      const localMatch = resolveOrganizationByCorporateCode(clean, allOrganizations);
      if (localMatch) {
        if (['SUSPENDIDA', 'DESACTIVADA', 'INACTIVA'].includes((localMatch.status || '').toUpperCase())) {
          return {
            ok: false,
            error: `La empresa "${localMatch.tradeName || localMatch.name}" se encuentra ${localMatch.status}.`,
          };
        }
        const info: ResolvedCorporateOrgInfo = {
          id: localMatch.id,
          tenantId: localMatch.tenantId || localMatch.tenant_id || localMatch.id,
          accessCode: (localMatch.accessCode || clean).toUpperCase(),
          name: localMatch.name,
          tradeName: localMatch.tradeName || localMatch.name,
          status: localMatch.status || 'ACTIVA',
          planCode: localMatch.planCode || 'EMPRESARIAL',
        };
        setSelectedCorporateCode(info.accessCode);
        setResolvedCorporateOrg(info);
        resolvedCorporateOrgRef.current = info;
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('axycore_corporate_code', info.accessCode);
          window.sessionStorage.setItem('axycore_resolved_corp_org', JSON.stringify(info));
        }
        return { ok: true, organization: info };
      }

      // 2. Check server-side Multi-Tenant directory before login
      try {
        const resp = await fetch('/api/auth/resolve-corporate-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: clean }),
        });
        const data = (await resp.json().catch(() => ({}))) as {
          found?: boolean;
          organization?: ResolvedCorporateOrgInfo;
          error?: string;
        };
        if (!resp.ok || !data.found || !data.organization) {
          return {
            ok: false,
            error:
              data.error ||
              `Código corporativo "${clean.toUpperCase()}" no encontrado. Verifica con tu administrador.`,
          };
        }
        setSelectedCorporateCode(data.organization.accessCode);
        setResolvedCorporateOrg(data.organization);
        resolvedCorporateOrgRef.current = data.organization;
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('axycore_corporate_code', data.organization.accessCode);
          window.sessionStorage.setItem('axycore_resolved_corp_org', JSON.stringify(data.organization));
        }
        return { ok: true, organization: data.organization };
      } catch {
        return {
          ok: false,
          error: 'No fue posible validar el código corporativo en este momento. Verifica tu conexión.',
        };
      }
    },
    [allOrganizations]
  );

  const enrollBiometrics = useCallback(async (): Promise<BiometricFlowResult> => {
    if (!firebaseUser || !userProfile) {
      return { ok: false, error: 'Inicia sesión antes de vincular FaceID / TouchID.' };
    }
    const result = await enrollBiometricCredential({
      uid: firebaseUser.uid,
      email: userProfile.email,
      displayName: userProfile.displayName,
      organizationId: userProfile.organizationId || DEFAULT_ORG_ID,
      organizationName: organization.tradeName || organization.name,
      providerId: firebaseUser.providerData[0]?.providerId || 'password',
    });
    if (result.ok && result.credential) {
      setLastBiometricCredential(result.credential);
      setBiometricSetupPending(false);
      setBiometricLocked(false);
      if (userProfile.role !== 'EXTERNAL_CLIENT') {
        recordCriticalAuditEvent({
          user: userProfile,
          eventType: 'AUTH_BIOMETRIC_ENROLLED',
          entityType: 'users',
          entityId: userProfile.uid,
          action: `Activación de autenticación biométrica (${result.credential.authenticatorLabel}) en dispositivo móvil`,
          newState: 'BIOMETRIA_ACTIVA',
        }).catch(() => {});
      }
    }
    return result;
  }, [firebaseUser, userProfile, organization]);

  const unlockWithBiometrics = useCallback(async (): Promise<BiometricFlowResult> => {
    if (!firebaseUser) {
      return { ok: false, error: 'No hay sesión activa para desbloquear.' };
    }
    const result = await authenticateWithBiometricCredential(firebaseUser.uid);
    if (result.ok) {
      setBiometricLocked(false);
      setLastBiometricCredential(result.credential || getStoredBiometricCredential(firebaseUser.uid));
      if (userProfile && userProfile.role !== 'EXTERNAL_CLIENT') {
        recordCriticalAuditEvent({
          user: userProfile,
          eventType: 'AUTH_BIOMETRIC_UNLOCK',
          entityType: 'users',
          entityId: userProfile.uid,
          action: `Desbloqueo biométrico exitoso (${result.credential?.authenticatorLabel || biometricLabel})`,
          newState: 'SESION_DESBLOQUEADA',
        }).catch(() => {});
      }
    }
    return result;
  }, [firebaseUser, userProfile, biometricLabel]);

  const lockWithBiometrics = useCallback(() => {
    if (!firebaseUser) return;
    if (!getStoredBiometricCredential(firebaseUser.uid)) return;
    clearBiometricSessionUnlocked(firebaseUser.uid);
    setBiometricLocked(true);
  }, [firebaseUser]);

  const disableBiometrics = useCallback(async () => {
    const targetUid = firebaseUser?.uid || lastBiometricCredential?.uid;
    if (targetUid) {
      removeStoredBiometricCredential(targetUid);
    }
    setBiometricLocked(false);
    setBiometricSetupPending(false);
    setLastBiometricCredential(getLastStoredBiometricCredential());
    if (userProfile && userProfile.role !== 'EXTERNAL_CLIENT') {
      recordCriticalAuditEvent({
        user: userProfile,
        eventType: 'AUTH_BIOMETRIC_DISABLED',
        entityType: 'users',
        entityId: userProfile.uid,
        action: `Desvinculación de acceso biométrico en dispositivo`,
        newState: 'BIOMETRIA_DESACTIVADA',
      }).catch(() => {});
    }
  }, [firebaseUser, lastBiometricCredential, userProfile]);

  const dismissBiometricSetup = useCallback(() => {
    postLoginBiometricSetupRef.current = false;
    setBiometricSetupPending(false);
  }, []);

  const requestPostLoginBiometricSetup = useCallback((enabled: boolean) => {
    postLoginBiometricSetupRef.current = enabled;
  }, []);

  const forgetQuickBiometricDevice = useCallback((uid?: string) => {
    const target = uid || lastBiometricCredential?.uid;
    if (target) {
      removeStoredBiometricCredential(target);
    }
    setLastBiometricCredential(getLastStoredBiometricCredential());
  }, [lastBiometricCredential]);

  const signInWithGoogle = async (loginHint?: string) => {
    setPortalAccessError(null);
    googleProvider.setCustomParameters({
      prompt: 'select_account',
      ...(loginHint ? { login_hint: loginHint } : {}),
    });
    const cred = await signInWithPopup(auth, googleProvider);
    if (cred.user) {
      markBiometricSessionUnlocked(cred.user.uid);
      setBiometricLocked(false);
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setPortalAccessError(null);
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    if (cred.user) {
      markBiometricSessionUnlocked(cred.user.uid);
      setBiometricLocked(false);
    }
  };

  const registerWithEmail = async (params: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<{ emailVerified: boolean; verificationSent: boolean }> => {
    setPortalAccessError(null);
    const cleanEmail = params.email.trim().toLowerCase();
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, params.password);
    if (params.displayName?.trim()) {
      await updateProfile(cred.user, { displayName: params.displayName.trim() }).catch(() => {});
    }
    let verificationSent = false;
    if (!cred.user.emailVerified) {
      try {
        const continueUrl =
          typeof window !== 'undefined' ? window.location.href : 'http://localhost:3000';
        await sendEmailVerification(cred.user, { url: continueUrl }).catch(async () => {
          await sendEmailVerification(cred.user);
        });
        verificationSent = true;
      } catch {
        verificationSent = false;
      }
    }
    markBiometricSessionUnlocked(cred.user.uid);
    setBiometricLocked(false);
    return {
      emailVerified: cred.user.emailVerified,
      verificationSent,
    };
  };

  const sendPasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const resendVerificationEmail = async () => {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
    }
  };

  const reloadAuthUser = async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    const refreshed = auth.currentUser;
    setFirebaseUser(refreshed);
    if (refreshed.emailVerified) {
      let profile = await bootstrapUserAndOrg(refreshed);
      const superUser = isSuperAdminUser(profile, refreshed.emailVerified);
      const targetCorp = resolvedCorporateOrgRef.current;

      if (
        portalModeRef.current === 'corporate' &&
        targetCorp &&
        targetCorp.id &&
        profile.organizationId !== targetCorp.id
      ) {
        try {
          const userMemberships = await fetchUserMembershipsFromStore(profile.uid);
          profile = await switchActiveOrganizationInStore({
            user: profile,
            targetOrganizationId: targetCorp.id,
            organizations: [
              SU_GLORIA_MANO_AMIGA_ORG,
              {
                ...SU_GLORIA_MANO_AMIGA_ORG,
                id: targetCorp.id,
                organizationId: targetCorp.id,
                tenantId: targetCorp.tenantId || targetCorp.id,
                accessCode: targetCorp.accessCode,
                name: targetCorp.name,
                tradeName: targetCorp.tradeName || targetCorp.name,
                status: (targetCorp.status as OrganizationRecord['status']) || 'ACTIVA',
              },
            ],
            memberships: userMemberships,
            isSuperAdmin: superUser,
          });
        } catch {
          // Keep bootstrapped organization from invitation
        }
      }

      setPortalAccessError(null);
      setUserProfile(profile);
      tenantService.setCurrentUser(profile);

      if (profile.role === 'EXTERNAL_CLIENT' && !superUser) {
        setPortalMode('client');
        setExternalPortalMode(true);
        setActiveSection('loans');
      } else if (portalModeRef.current === 'axycore_admin' && superUser) {
        setExternalPortalMode(false);
        setActiveSection('platform_control');
      } else {
        setPortalMode('corporate');
        setExternalPortalMode(false);
        setActiveSection('dashboard');
      }
    }
  };

  const logout = async () => {
    if (userProfile && userProfile.role !== 'EXTERNAL_CLIENT') {
      await recordCriticalAuditEvent({
        user: userProfile,
        eventType: 'AUTH_LOGOUT',
        entityType: 'users',
        entityId: userProfile.uid,
        action: `Cierre de sesión voluntario (${userProfile.email})`,
        previousState: 'SESION_ACTIVA',
        newState: 'SESION_CERRADA',
      }).catch(() => {});
    }
    clearBiometricSessionUnlocked(firebaseUser?.uid);
    setBiometricLocked(false);
    setBiometricSetupPending(false);
    setPortalAccessError(null);
    setPortalMode(null);
    clearCorporateAccessSelection();
    postLoginBiometricSetupRef.current = false;
    setDirectorAnalysis(null);
    setDirectorError(null);
    setBelaOpen(false);
    setExternalPortalMode(false);
    await signOut(auth);
  };

  const emailVerificationPending = Boolean(firebaseUser && !firebaseUser.emailVerified);
  const biometricEnrolled = Boolean(
    firebaseUser && getStoredBiometricCredential(firebaseUser.uid)
  );

  // Executive Home Analytics & AI Context
  const clockInfo = useMemo(() => getSantoDomingoClockInfo(), []);
  const periodBounds = useMemo(
    () =>
      resolvePeriodBounds(
        executivePeriod,
        customRangeStart,
        customRangeEnd,
        clockInfo.todayIso
      ),
    [executivePeriod, customRangeStart, customRangeEnd, clockInfo.todayIso]
  );

  const dopMetrics = useMemo(
    () =>
      computeExecutiveCurrencyMetrics({
        currency: 'DOP',
        bounds: periodBounds,
        todayIso: clockInfo.todayIso,
        applications,
        loans,
        loanInstallments,
        collectionAccounts,
        payments,
        paymentPromises,
        usersList,
      }),
    [
      periodBounds,
      clockInfo.todayIso,
      applications,
      loans,
      loanInstallments,
      collectionAccounts,
      payments,
      paymentPromises,
      usersList,
    ]
  );

  const usdMetrics = useMemo(
    () =>
      computeExecutiveCurrencyMetrics({
        currency: 'USD',
        bounds: periodBounds,
        todayIso: clockInfo.todayIso,
        applications,
        loans,
        loanInstallments,
        collectionAccounts,
        payments,
        paymentPromises,
        usersList,
      }),
    [
      periodBounds,
      clockInfo.todayIso,
      applications,
      loans,
      loanInstallments,
      collectionAccounts,
      payments,
      paymentPromises,
      usersList,
    ]
  );

  const operationalDayItems = useMemo(
    () =>
      buildOperationalDaySummary({
        todayIso: clockInfo.todayIso,
        applications,
        loanInstallments,
        paymentPromises,
        payments,
        reconciliationExceptions,
        collectionTasks,
        riskAlerts,
        canAccessSection: rbac.canAccessSection,
        hasPermission: rbac.hasPermission,
      }),
    [
      clockInfo.todayIso,
      applications,
      loanInstallments,
      paymentPromises,
      payments,
      reconciliationExceptions,
      collectionTasks,
      riskAlerts,
      rbac,
    ]
  );

  const recentActivityItems = useMemo(
    () =>
      buildRecentAuthorizedActivity({
        auditLogs,
        hasPermission: rbac.hasPermission,
        canAccessSection: rbac.canAccessSection,
        limit: 10,
      }),
    [auditLogs, rbac]
  );

  const buildCurrentAiScope = useCallback(() => {
    if (!userProfile) return {};
    return buildScopedAiContext({
      userProfile,
      roleLabel: rbac.roleLabel,
      organizationName: organization.name,
      periodLabel: periodBounds.label,
      currencyFilter: executiveCurrency,
      dopMetrics,
      usdMetrics,
      operationalItems: operationalDayItems,
      recentActivity: recentActivityItems,
      applications,
      loans,
      collectionActions,
      riskAlerts,
      hasPermission: rbac.hasPermission,
    });
  }, [
    userProfile,
    rbac,
    organization.name,
    periodBounds.label,
    executiveCurrency,
    dopMetrics,
    usdMetrics,
    operationalDayItems,
    recentActivityItems,
    applications,
    loans,
    collectionActions,
    riskAlerts,
  ]);

  const runDirectorAnalysis = useCallback(
    async (question?: string) => {
      if (!userProfile) return;
      setDirectorLoading(true);
      setDirectorError(null);
      try {
        const result = (await fetchDirectorAnalysisFromApi({
          question,
          scopedContext: buildCurrentAiScope(),
          actorId: userProfile.uid,
        })) as DirectorAnalysisResponse;
        setDirectorAnalysis(result);
        setLastSyncedAtIso(new Date().toISOString());
      } catch (err) {
        setDirectorError(
          err instanceof Error
            ? err.message
            : 'No fue posible completar el análisis de AxyCore Director.'
        );
      } finally {
        setDirectorLoading(false);
      }
    },
    [userProfile, buildCurrentAiScope]
  );

  const sendBelaMessage = useCallback(
    async (message: string) => {
      if (!userProfile || !message.trim()) return;
      const trimmed = message.trim();
      const userMsg: BelaChatMessage = {
        id: `bela_u_${Date.now()}`,
        role: 'user',
        content: trimmed,
        timestampIso: new Date().toISOString(),
      };
      const nextHistory = [...belaMessages, userMsg];
      setBelaMessages(nextHistory);
      setBelaLoading(true);

      try {
        const res = await fetchBelaAssistantFromApi({
          message: trimmed,
          history: nextHistory
            .filter((m) => !m.isError)
            .slice(-8)
            .map((m) => ({ role: m.role, content: m.content })),
          scopedContext: buildCurrentAiScope(),
          actorId: userProfile.uid,
        });
        const assistantMsg: BelaChatMessage = {
          id: `bela_a_${Date.now()}`,
          role: 'assistant',
          content: res.reply,
          verifiedFacts: res.verifiedFacts,
          actions: res.actions,
          timestampIso: new Date().toISOString(),
        };
        setBelaMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        const errText =
          err instanceof Error
            ? err.message
            : 'Ocurrió un inconveniente al consultar a Bela.';
        setBelaMessages((prev) => [
          ...prev,
          {
            id: `bela_err_${Date.now()}`,
            role: 'assistant',
            content: errText,
            isError: true,
            timestampIso: new Date().toISOString(),
          },
        ]);
      } finally {
        setBelaLoading(false);
      }
    },
    [userProfile, belaMessages, buildCurrentAiScope]
  );

  const clearBelaHistory = useCallback(() => {
    setBelaMessages([
      {
        id: 'bela_welcome',
        role: 'assistant',
        content: '¡Hola! Soy Bela, tu asistente inteligente. ¿En qué puedo ayudarte hoy?',
        timestampIso: new Date().toISOString(),
      },
    ]);
  }, []);

  const activeCollectionPolicy = useMemo<CollectionPolicyVersionRecord>(() => {
    const active = collectionPolicies.find((p) => p.status === 'ACTIVA');
    if (active) return active;
    const proposed = collectionPolicies.find((p) => p.status === 'PROPUESTA');
    return proposed ?? DEFAULT_COLLECTION_POLICY_V1;
  }, [collectionPolicies]);

  const refreshInstallments = useCallback(async () => {
    if (!userProfile || userProfile.role === 'EXTERNAL_CLIENT') return;
    const rows = await fetchAllOrgInstallments(userProfile.organizationId || DEFAULT_ORG_ID);
    setLoanInstallments(rows);
  }, [userProfile]);

  const runDailyCollectionsSync = useCallback(
    async (opts?: { asOfDateIso?: string; saveSnapshot?: boolean }) => {
      if (!userProfile || userProfile.role === 'EXTERNAL_CLIENT') {
        return { syncedLoans: 0, newAlerts: 0, newTasks: 0 };
      }
      const orgId = userProfile.organizationId || DEFAULT_ORG_ID;
      const freshInsts =
        loanInstallments.length > 0 ? loanInstallments : await fetchAllOrgInstallments(orgId);
      return syncDisbursedLoansAndDailyCutoff({
        user: userProfile,
        loans,
        installments: freshInsts,
        customers,
        existingAccounts: rawCollectionAccounts,
        promises: paymentPromises,
        payments,
        actions: collectionActions,
        disputes: customerDisputes,
        exceptions: reconciliationExceptions,
        existingAlerts: riskAlerts,
        existingTasks: collectionTasks,
        policy: activeCollectionPolicy,
        asOfDateIso: opts?.asOfDateIso,
        saveSnapshot: opts?.saveSnapshot ?? true,
      });
    },
    [
      userProfile,
      loanInstallments,
      loans,
      customers,
      rawCollectionAccounts,
      paymentPromises,
      payments,
      collectionActions,
      customerDisputes,
      reconciliationExceptions,
      riskAlerts,
      collectionTasks,
      activeCollectionPolicy,
    ]
  );

  const value: AxyCoreContextValue = {
    firebaseUser,
    userProfile,
    authReady,
    dataLoading,
    darkMode,
    setDarkMode,
    toggleDarkMode: () => setDarkMode((d) => !d),
    activeSection,
    setActiveSection: guardedSetActiveSection,
    externalPortalMode,
    setExternalPortalMode,
    selectedApplicationId,
    setSelectedApplicationId,
    selectedCollectionLoanId,
    setSelectedCollectionLoanId,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    sendPasswordReset,
    resendVerificationEmail,
    reloadAuthUser,
    emailVerificationPending,
    logout,
    portalMode,
    setPortalMode,
    switchPortalMode,
    pendingInviteLinkInfo,
    selectedCorporateCode,
    resolvedCorporateOrg,
    resolveCorporateAccessCode,
    clearCorporateAccessSelection,
    portalAccessError,
    clearPortalAccessError,
    biometricSupported,
    biometricLabel,
    biometricEnrolled,
    biometricLocked,
    biometricSetupPending,
    lastBiometricCredential,
    enrollBiometrics,
    unlockWithBiometrics,
    lockWithBiometrics,
    disableBiometrics,
    dismissBiometricSetup,
    requestPostLoginBiometricSetup,
    forgetQuickBiometricDevice,
    executivePeriod,
    setExecutivePeriod,
    customRangeStart,
    customRangeEnd,
    setCustomRange,
    executiveCurrency,
    setExecutiveCurrency,
    lastSyncedAtIso,
    clockInfo,
    periodBounds,
    dopMetrics,
    usdMetrics,
    operationalDayItems,
    recentActivityItems,
    aiConfigured,
    directorAnalysis,
    directorLoading,
    directorError,
    runDirectorAnalysis,
    belaOpen,
    setBelaOpen,
    belaMessages,
    belaLoading,
    sendBelaMessage,
    clearBelaHistory,
    organization,
    usersList,
    userInvitations,
    customers,
    businesses,
    applications,
    documents,
    policies,
    activeOrTestPolicy,
    scoringExecutions,
    financialAnalyses,
    applicationDecisionHistory,
    evaluations,
    committeeDecisions,
    formalizations,
    disbursements,
    loans,
    loanInstallments,
    collectionAccounts,
    collectionAssignments,
    collectionActions,
    collectionTasks,
    paymentPromises,
    paymentAgreements,
    payments,
    paymentAllocations,
    paymentReversals,
    collectionReceipts,
    paymentIntents,
    bankTransactions,
    reconciliationMatches,
    reconciliationExceptions,
    collectorTargets,
    collectionCampaigns,
    messageTemplates,
    messageEvents,
    riskAlerts,
    customerDisputes,
    collectionPolicies,
    activeCollectionPolicy,
    collectionDailySnapshots,
    collectionsIntegrationsStatus,
    runDailyCollectionsSync,
    refreshInstallments,
    operatingExpenses,
    investors,
    investorTransactions,
    accountingAccounts,
    journalEntries,
    dgiiFiscalConfigs,
    activeDgiiConfig,
    dgiiCertificates,
    dgiiSequences,
    dgiiReceivers,
    dgiiProducts,
    dgiiEcfDocuments,
    dgiiAuditLogs,
    alteraScenarios,
    alteraRecommendations,
    alteraOutcomes,
    alteraAnalyses,
    alteraConfig,
    saveAlteraScenarioEntry,
    createAlteraRecommendationEntry,
    updateAlteraRecommendationStatus,
    recordAlteraOutcomeCalibration,
    logAlteraAnalysis,
    updateAlteraConfigSettings,
    auditLogs,
    emailNotifications,
    smtpConfigured,
    inboxAlerts,
    unreadAlertCount,
    liveToasts,
    dismissLiveToast,
    acknowledgeAlert,
    acknowledgeAllAlerts,
    desktopNotifPermission,
    desktopNotifEnabled,
    requestDesktopNotifications,
    toggleDesktopNotifications,
    fcmStatus,
    fcmToken,
    fcmError,
    fcmVapidConfigured,
    fcmActiveDevicesCount,
    pushDeliveryMode,
    pushSubscribedStatuses,
    enableFcmPush,
    disableFcmPush,
    updatePushStatusPreferences,
    sendTestPush,
    rbac,
    isSuperAdmin,
    isPlatformAdminPortal,
    allOrganizations,
    organizationMemberships,
    tenantLicenses,
    tenantSubscriptions,
    availableWorkspaces,
    switchOrganizationWorkspace,
    getSectionTenantAccess,
    tenantService,
  };

  return (
    <AxyCoreContext.Provider value={value}>
      {children}
    </AxyCoreContext.Provider>
  );
}

export function useAxyCore() {
  const ctx = useContext(AxyCoreContext);
  if (!ctx) throw new Error('useAxyCore debe usarse dentro de AxyCoreProvider.');
  return ctx;
}
