import { DEFAULT_POLICY_V2 } from '../decisionEngineV2';
import type {
  ApplicationRecord,
  BusinessRecord,
  CollectionAccountRecord,
  CreditPolicyRecord,
  CurrencyCode,
  CustomerRecord,
  LoanInstallmentRecord,
  LoanRecord,
  PaymentFrequency,
  PaymentRecord,
  ProductCode,
  RiskAlertRecord,
  UserProfile,
} from '../../types/axycore';
import {
  IMPULSA_CATEGORY_LABELS,
  IMPULSA_STATUS_LABELS,
  type ImpulsaAssistantMessage,
  type ImpulsaChartDatasets,
  type ImpulsaCommercialMetrics,
  type ImpulsaEngineConfig,
  type ImpulsaEvidenceMetric,
  type ImpulsaInternalAlert,
  type ImpulsaOpportunityCategory,
  type ImpulsaOpportunityRecord,
  type ImpulsaOpportunityStatus,
  type ImpulsaPriority,
  type ImpulsaRiskSignal,
} from '../../types/impulsa';

export const IMPULSA_ENGINE_VERSION = '1.0.0';

const COMMERCIAL_DISCLAIMER =
  'Sugerencia comercial de Impulsa basada en comportamiento histórico. No constituye aprobación crediticia; toda solicitud pasa por el Motor de Decisiones V2, políticas vigentes y Comité.';

const ACTIVE_APPLICATION_STATUSES = new Set([
  'BORRADOR',
  'RECIBIDA',
  'EN_EVALUACION',
  'EN_COMITE',
  'APROBADA',
  'APROBADA_CONDICIONADA',
  'FORMALIZADA',
]);

const TERMINAL_IMPULSA_STATUSES = new Set<ImpulsaOpportunityStatus>([
  'DESEMBOLSADA',
  'DESCARTADA',
  'NO_INTERESADO',
]);

const OPEN_CENTINELA_STATUSES = new Set(['ACTIVA', 'EN_REVISION']);

export function buildDefaultImpulsaConfig(organizationId: string): ImpulsaEngineConfig {
  return {
    id: organizationId,
    organizationId,
    enabled: true,
    frequency: 'DIARIA',
    assignmentStrategy: 'LOAN_OWNER_FIRST',
    earlyRenewalMaxRemainingInstallments: 3,
    earlyRenewalMinPaidRatioPct: 65,
    earlyRenewalMaxDpd: 5,
    excellentBehaviorMinPaidInstallments: 3,
    excellentBehaviorMaxHistoricalDpd: 5,
    growthMinPaidRatioPct: 40,
    growthMaxIncreaseFactor: 1.35,
    earlyPaymentMinCount: 2,
    inactiveMinDaysSinceClose: 20,
    inactiveMaxHistoricalDpd: 15,
    refinancingMinDpd: 1,
    refinancingMaxDpd: 45,
    refinancingMinPaidRatioPct: 20,
    unmanagedAlertHours: 48,
    opportunityWindowDays: 30,
    blockCommercialOffersOnCriticalCentinela: true,
    notifyInternalAlerts: true,
    requireExplicitConsentForExternalContact: true,
    lastRunAtIso: null,
    recentRuns: [],
    updatedBy: 'SYSTEM',
    updatedByName: 'Configuración base Impulsa',
  };
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function roundTo500(amount: number, currency: CurrencyCode): number {
  if (currency === 'USD') {
    return Math.max(50, Math.round(amount / 50) * 50);
  }
  return Math.max(1000, Math.round(amount / 500) * 500);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function daysBetween(startIso?: string | null, endIso?: string | null): number {
  if (!startIso || !endIso) return 0;
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

function addDaysIso(baseIso: string, days: number): string {
  const d = new Date(baseIso);
  if (Number.isNaN(d.getTime())) return new Date(Date.now() + days * 86_400_000).toISOString();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function formatMoney(amount: number, currency: CurrencyCode): string {
  const prefix = currency === 'USD' ? 'US$' : 'RD$';
  return `${prefix}${round2(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function toDop(amount: number, currency: CurrencyCode, dopPerUsd: number): number {
  if (currency === 'USD') return round2(amount * (dopPerUsd > 0 ? dopPerUsd : 60));
  return round2(amount);
}

function getPeriodsPerMonth(freq: PaymentFrequency): number {
  switch (freq) {
    case 'DIARIA':
      return 30;
    case 'SEMANAL':
      return 4;
    case 'QUINCENAL':
      return 2;
    case 'MENSUAL':
    default:
      return 1;
  }
}

export function estimateMonthlyInstallment(
  principal: number,
  monthlyRatePct: number,
  termMonths: number
): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  const r = Math.max(0, monthlyRatePct) / 100;
  if (r === 0) return round2(principal / termMonths);
  const factor = Math.pow(1 + r, termMonths);
  return round2((principal * (r * factor)) / (factor - 1));
}

export function estimateSustainablePrincipal(
  maxMonthlyInstallment: number,
  monthlyRatePct: number,
  termMonths: number
): number {
  if (maxMonthlyInstallment <= 0 || termMonths <= 0) return 0;
  const r = Math.max(0, monthlyRatePct) / 100;
  if (r === 0) return round2(maxMonthlyInstallment * termMonths);
  const factor = Math.pow(1 + r, termMonths);
  return round2((maxMonthlyInstallment * (factor - 1)) / (r * factor));
}

function estimateGrossInterest(
  principal: number,
  monthlyRatePct: number,
  termMonths: number
): number {
  const monthly = estimateMonthlyInstallment(principal, monthlyRatePct, termMonths);
  return Math.max(0, round2(monthly * termMonths - principal));
}

function resolveBandMonthlyRate(policy: CreditPolicyRecord, score?: number | null): number {
  const bands = policy.riskBands || DEFAULT_POLICY_V2.riskBands;
  if (typeof score === 'number' && Number.isFinite(score)) {
    const match = bands.find((b) => score >= b.minScore && score <= b.maxScore);
    if (match && typeof match.monthlyRate === 'number' && match.monthlyRate > 0) {
      return match.monthlyRate <= 1 ? round2(match.monthlyRate * 100) : round2(match.monthlyRate);
    }
  }
  const ref = policy.capacityConfig?.referenceSimulationMonthlyRate ?? 0.045;
  return ref <= 1 ? round2(ref * 100) : round2(ref);
}

function computePriority(score: number): ImpulsaPriority {
  if (score >= 82) return 'CRITICA';
  if (score >= 66) return 'ALTA';
  if (score >= 48) return 'MEDIA';
  return 'BAJA';
}

function buildSourceKey(
  orgId: string,
  customerId: string,
  category: ImpulsaOpportunityCategory,
  sourceLoanId?: string | null
): string {
  return `${orgId}__${customerId}__${category}__${sourceLoanId || 'PORTFOLIO'}`;
}

function buildOpportunityCode(
  category: ImpulsaOpportunityCategory,
  customerId: string,
  sourceLoanId?: string | null
): string {
  const prefixMap: Record<ImpulsaOpportunityCategory, string> = {
    RENOVACION_ANTICIPADA: 'REN',
    EXCELENTE_COMPORTAMIENTO: 'EXC',
    CRECIMIENTO_CREDITICIO: 'CRE',
    PAGO_ANTICIPADO: 'ANT',
    CLIENTE_INACTIVO: 'REC',
    NUEVO_PRODUCTO: 'NPR',
    REFINANCIAMIENTO_RESPONSABLE: 'REF',
  };
  const raw = `${customerId}${sourceLoanId || ''}`.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const suffix = raw.slice(-6).padStart(6, '0');
  return `IMP-${prefixMap[category]}-${suffix}`;
}

export interface CustomerFinancialProfile {
  customer: CustomerRecord;
  customerName: string;
  branchOrProvince: string;
  hasBusiness: boolean;
  business?: BusinessRecord;
  loans: LoanRecord[];
  activeLoans: LoanRecord[];
  closedLoans: LoanRecord[];
  applications: ApplicationRecord[];
  latestApplication?: ApplicationRecord;
  hasActiveApplication: boolean;
  collectionAccounts: CollectionAccountRecord[];
  openCentinelaAlerts: RiskAlertRecord[];
  hasCriticalCentinelaAlert: boolean;
  monthlyIncome: number;
  monthlyExpenses: number;
  currentDebtPayments: number;
  availableMonthlyFlow: number;
  currentDtiPct: number | null;
  latestOriginationScore: number | null;
  averageBehaviorScore: number | null;
  maxHistoricalDpd: number;
  currentMaxDpd: number;
  earlyPaymentsCount: number;
  onTimePaymentsRatioPct: number;
  incomeCurrency: CurrencyCode;
  knownOfficerId: string | null;
  knownOfficerName: string | null;
}

function computeCustomerProfile(params: {
  customer: CustomerRecord;
  businesses: BusinessRecord[];
  loans: LoanRecord[];
  installmentsByLoan: Map<string, LoanInstallmentRecord[]>;
  paymentsByCustomer: Map<string, PaymentRecord[]>;
  applicationsByCustomer: Map<string, ApplicationRecord[]>;
  collectionAccountsByLoan: Map<string, CollectionAccountRecord>;
  riskAlertsByCustomer: Map<string, RiskAlertRecord[]>;
  policy: CreditPolicyRecord;
  usersById: Map<string, UserProfile>;
}): CustomerFinancialProfile {
  const {
    customer,
    businesses,
    loans,
    installmentsByLoan,
    paymentsByCustomer,
    applicationsByCustomer,
    collectionAccountsByLoan,
    riskAlertsByCustomer,
    policy,
    usersById,
  } = params;

  const customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Cliente';
  const customerLoans = loans.filter((l) => l.customerId === customer.id);
  const activeLoans = customerLoans.filter((l) => l.status === 'ACTIVO' || l.status === 'VENCIDO');
  const closedLoans = customerLoans.filter((l) => l.status === 'PAGADO' || l.status === 'CANCELADO');
  const customerApps = [...(applicationsByCustomer.get(customer.id) || [])].sort((a, b) =>
    String(b.id).localeCompare(String(a.id))
  );
  const latestApplication = customerApps[0];
  const hasActiveApplication = customerApps.some((a) => ACTIVE_APPLICATION_STATUSES.has(a.status));

  const business = businesses.find(
    (b) =>
      b.id === latestApplication?.businessId ||
      customerLoans.some((l) => l.businessId && l.businessId === b.id) ||
      (customer.documentNumber && b.authorizedRepDoc === customer.documentNumber)
  );

  const accounts: CollectionAccountRecord[] = [];
  for (const loan of customerLoans) {
    const acc = collectionAccountsByLoan.get(loan.id);
    if (acc) accounts.push(acc);
  }

  const openCentinelaAlerts = (riskAlertsByCustomer.get(customer.id) || []).filter((a) =>
    OPEN_CENTINELA_STATUSES.has(a.status)
  );
  const hasCriticalCentinelaAlert = openCentinelaAlerts.some(
    (a) => a.severity === 'CRITICA' || a.severity === 'ALTA'
  );

  // Extract real financial capacity from latest verified or declared application data
  const fin = latestApplication?.verifiedFinancialData || latestApplication?.financialData;
  const bizFin =
    latestApplication?.verifiedBusinessFinancialData || latestApplication?.businessFinancialData;

  const additionalFactor = policy.capacityConfig?.additionalIncomeFactor ?? 0.5;
  const primaryIncome = Number(fin?.primaryNetIncome || 0);
  const additionalIncome = Number(fin?.additionalNetIncome || 0);
  const declaredTotal = Number(fin?.declaredTotalMonthlyIncome || 0);
  const businessNetFlow = Number(bizFin?.netMonthlyFlow || 0);

  let monthlyIncome = 0;
  if (primaryIncome > 0 || additionalIncome > 0) {
    monthlyIncome = primaryIncome + additionalIncome * additionalFactor;
  } else if (declaredTotal > 0) {
    monthlyIncome = declaredTotal;
  }
  if (businessNetFlow > 0) {
    monthlyIncome = Math.max(monthlyIncome, businessNetFlow);
  }

  const essentialExpenses =
    Number(fin?.essentialExpenses || 0) +
    (fin?.housingIncludedInExpenses ? 0 : Number(fin?.housingPayment || customer.housingPayment || 0));

  // Estimate current active internal loan monthly obligations
  const activeInternalMonthlyInstallments = activeLoans.reduce((sum, loan) => {
    const insts = installmentsByLoan.get(loan.id) || [];
    const sampleInst = insts.find((i) => i.status !== 'PAGADA') || insts[0];
    const perInstallment = sampleInst
      ? Number(sampleInst.totalAmount || 0)
      : estimateMonthlyInstallment(
          loan.totalFinancedPrincipal || loan.approvedPrincipal,
          loan.contractualRateMonthly <= 1
            ? loan.contractualRateMonthly * 100
            : loan.contractualRateMonthly,
          Math.max(1, loan.termMonths)
        );
    const periodsPerMonth = getPeriodsPerMonth(loan.frequency);
    const monthlyEquiv = sampleInst ? perInstallment * periodsPerMonth : perInstallment;
    return sum + monthlyEquiv;
  }, 0);

  const declaredExternalDebts =
    Number(fin?.currentDebtPayments || 0) + Number(bizFin?.businessObligationsMonthly || 0);
  const currentDebtPayments = Math.max(declaredExternalDebts, activeInternalMonthlyInstallments);

  const availableMonthlyFlow = Math.max(0, round2(monthlyIncome - essentialExpenses - currentDebtPayments));
  const currentDtiPct =
    monthlyIncome > 0 ? round2((currentDebtPayments / monthlyIncome) * 100) : null;

  // Analyze installments & payments for early payments and punctuality
  let totalPaidInstallments = 0;
  let earlyPaymentsCount = 0;
  let onTimePaidCount = 0;
  let maxHistoricalDpd = 0;
  let currentMaxDpd = 0;

  for (const acc of accounts) {
    maxHistoricalDpd = Math.max(maxHistoricalDpd, Number(acc.maxHistoricalDpd || 0), Number(acc.dpd || 0));
    if (acc.stage !== 'CANCELADO') {
      currentMaxDpd = Math.max(currentMaxDpd, Number(acc.dpd || 0));
    }
  }

  for (const loan of customerLoans) {
    const insts = installmentsByLoan.get(loan.id) || [];
    for (const inst of insts) {
      if (inst.status === 'PAGADA') {
        totalPaidInstallments += 1;
        if (inst.paidAt && inst.dueDate) {
          const diff = daysBetween(inst.paidAt.slice(0, 10), inst.dueDate.slice(0, 10));
          if (diff >= 3) {
            earlyPaymentsCount += 1;
            onTimePaidCount += 1;
          } else if (diff >= -3) {
            onTimePaidCount += 1;
          }
        } else {
          onTimePaidCount += 1;
        }
      }
    }
  }

  // Also check applied payments before due date or large prepayments
  const appliedPayments = (paymentsByCustomer.get(customer.id) || []).filter(
    (p) => p.status === 'APLICADO' || p.status === 'VERIFICADO'
  );
  if (earlyPaymentsCount === 0 && appliedPayments.length > 0) {
    for (const loan of closedLoans) {
      if (loan.closedAt && loan.maturityDate) {
        const daysEarly = daysBetween(loan.closedAt.slice(0, 10), loan.maturityDate.slice(0, 10));
        if (daysEarly >= 15) {
          earlyPaymentsCount += 2;
        }
      }
    }
  }

  const onTimePaymentsRatioPct =
    totalPaidInstallments > 0
      ? round2((onTimePaidCount / totalPaidInstallments) * 100)
      : maxHistoricalDpd <= 3 && closedLoans.length > 0
      ? 100
      : 0;

  const behaviorScores = accounts
    .map((a) => Number(a.behaviorScore))
    .filter((v) => Number.isFinite(v) && v > 0);
  const averageBehaviorScore =
    behaviorScores.length > 0
      ? round2(behaviorScores.reduce((s, v) => s + v, 0) / behaviorScores.length)
      : null;

  const latestOriginationScore =
    typeof latestApplication?.latestScore === 'number' ? latestApplication.latestScore : null;

  // Determine branch/province from collection account or customer
  const branchOrProvince =
    accounts.find((a) => a.branchName)?.branchName ||
    customer.province ||
    customer.municipality ||
    'Sede Principal';

  // Identify known officer from latest application or loan creator
  const candidateUid =
    latestApplication?.assignedTo ||
    latestApplication?.createdBy ||
    activeLoans[0]?.createdBy ||
    customerLoans[0]?.createdBy ||
    null;
  const knownOfficer = candidateUid ? usersById.get(candidateUid) : undefined;
  const knownOfficerId =
    knownOfficer &&
    knownOfficer.status === 'ACTIVE' &&
    knownOfficer.role !== 'EXTERNAL_CLIENT'
      ? knownOfficer.uid
      : null;
  const knownOfficerName = knownOfficerId
    ? knownOfficer?.displayName || knownOfficer?.email || null
    : null;

  return {
    customer,
    customerName,
    branchOrProvince,
    hasBusiness: Boolean(business || latestApplication?.applicantType === 'BUSINESS'),
    business,
    loans: customerLoans,
    activeLoans,
    closedLoans,
    applications: customerApps,
    latestApplication,
    hasActiveApplication,
    collectionAccounts: accounts,
    openCentinelaAlerts,
    hasCriticalCentinelaAlert,
    monthlyIncome: round2(monthlyIncome),
    monthlyExpenses: round2(essentialExpenses),
    currentDebtPayments: round2(currentDebtPayments),
    availableMonthlyFlow,
    currentDtiPct,
    latestOriginationScore,
    averageBehaviorScore,
    maxHistoricalDpd,
    currentMaxDpd,
    earlyPaymentsCount,
    onTimePaymentsRatioPct,
    incomeCurrency: fin?.incomeCurrency || activeLoans[0]?.currency || 'DOP',
    knownOfficerId,
    knownOfficerName,
  };
}

function validateAndBoundOffer(params: {
  policy: CreditPolicyRecord;
  productCode: ProductCode;
  rawAmount: number;
  rawTermMonths: number;
  profile: CustomerFinancialProfile;
  replacesCurrentLoanMonthlyPayment?: number;
}): {
  amount: number;
  termMonths: number;
  ratePct: number;
  installment: number;
  netProfit: number;
  projectedDtiPct: number | null;
  policyCompliant: boolean;
  policyNotes: string[];
  capacityCapped: boolean;
} {
  const {
    policy,
    productCode,
    rawAmount,
    rawTermMonths,
    profile,
    replacesCurrentLoanMonthlyPayment = 0,
  } = params;

  const productCfg = policy.products?.[productCode] || DEFAULT_POLICY_V2.products[productCode];
  const ratePct = resolveBandMonthlyRate(policy, profile.latestOriginationScore);
  const termMonths = clamp(
    Math.round(rawTermMonths),
    productCfg.minTermMonths,
    productCfg.maxTermMonths
  );
  const policyNotes: string[] = [];

  // Calculate maximum capacity-backed principal if income data exists
  let capacityCapped = false;
  let maxAllowedByCapacity = productCfg.maxAmount;
  const maxNewInstallmentRatio = policy.capacityConfig?.maxNewInstallmentRatio ?? 0.35;
  const maxProjectedDti = policy.capacityConfig?.maxProjectedDti ?? 0.5;
  const minCoverage = policy.capacityConfig?.minCoverageRatio ?? 1.25;

  if (profile.monthlyIncome > 0) {
    const adjustedDebt = Math.max(0, profile.currentDebtPayments - replacesCurrentLoanMonthlyPayment);
    const adjustedFlow = Math.max(0, profile.monthlyIncome - profile.monthlyExpenses - adjustedDebt);
    const dtiRoom = Math.max(0, profile.monthlyIncome * maxProjectedDti - adjustedDebt);
    const ratioRoom = profile.monthlyIncome * maxNewInstallmentRatio;
    const coverageRoom = adjustedFlow / Math.max(1, minCoverage);
    const maxSafeInstallment = Math.max(0, Math.min(dtiRoom, ratioRoom, coverageRoom));

    if (maxSafeInstallment > 0) {
      maxAllowedByCapacity = estimateSustainablePrincipal(maxSafeInstallment, ratePct, termMonths);
    } else {
      maxAllowedByCapacity = 0;
    }
  } else {
    policyNotes.push(
      'Sin ingresos declarados recientes en expediente; monto acotado conservadoramente al historial interno y sujeto a verificación de ingresos.'
    );
  }

  let boundedAmount = Math.min(rawAmount, productCfg.maxAmount);
  if (profile.monthlyIncome > 0 && boundedAmount > maxAllowedByCapacity) {
    boundedAmount = maxAllowedByCapacity;
    capacityCapped = true;
    policyNotes.push(
      `Monto ajustado automáticamente por capacidad de pago y DTI máximo (${Math.round(
        maxProjectedDti * 100
      )}%).`
    );
  }

  boundedAmount = roundTo500(boundedAmount, productCfg.currency);
  let policyCompliant = true;

  if (boundedAmount < productCfg.minAmount) {
    if (profile.monthlyIncome > 0 && maxAllowedByCapacity < productCfg.minAmount) {
      policyCompliant = false;
      policyNotes.push(
        `Capacidad estimada (${formatMoney(maxAllowedByCapacity, productCfg.currency)}) inferior al mínimo del producto (${formatMoney(
          productCfg.minAmount,
          productCfg.currency
        )}).`
      );
      boundedAmount = productCfg.minAmount;
    } else {
      boundedAmount = productCfg.minAmount;
    }
  }

  if (boundedAmount > productCfg.maxAmount) {
    boundedAmount = productCfg.maxAmount;
  }

  const installment = estimateMonthlyInstallment(boundedAmount, ratePct, termMonths);
  const netProfit = estimateGrossInterest(boundedAmount, ratePct, termMonths);
  const adjustedDebt = Math.max(0, profile.currentDebtPayments - replacesCurrentLoanMonthlyPayment);
  const projectedDtiPct =
    profile.monthlyIncome > 0
      ? round2(((adjustedDebt + installment) / profile.monthlyIncome) * 100)
      : null;

  if (projectedDtiPct !== null && projectedDtiPct > maxProjectedDti * 100 + 0.5) {
    policyCompliant = false;
    policyNotes.push(
      `DTI proyectado (${projectedDtiPct}%) excede política vigente (${Math.round(
        maxProjectedDti * 100
      )}%).`
    );
  } else if (policyNotes.length === 0) {
    policyNotes.push(
      `Cumple límites vigentes de ${productCfg.label} (${formatMoney(
        productCfg.minAmount,
        productCfg.currency
      )} – ${formatMoney(productCfg.maxAmount, productCfg.currency)}) y plazo ${productCfg.minTermMonths}–${productCfg.maxTermMonths} meses.`
    );
  }

  return {
    amount: boundedAmount,
    termMonths,
    ratePct,
    installment,
    netProfit,
    projectedDtiPct,
    policyCompliant,
    policyNotes,
    capacityCapped,
  };
}

export interface DetectImpulsaInput {
  organizationId: string;
  customers: CustomerRecord[];
  businesses: BusinessRecord[];
  loans: LoanRecord[];
  loanInstallments: LoanInstallmentRecord[];
  payments: PaymentRecord[];
  applications: ApplicationRecord[];
  collectionAccounts: CollectionAccountRecord[];
  riskAlerts: RiskAlertRecord[];
  policy: CreditPolicyRecord;
  users: UserProfile[];
  existingOpportunities: ImpulsaOpportunityRecord[];
  config: ImpulsaEngineConfig;
  actorId?: string;
  nowIso?: string;
}

export interface DetectImpulsaResult {
  opportunities: ImpulsaOpportunityRecord[];
  created: ImpulsaOpportunityRecord[];
  updated: ImpulsaOpportunityRecord[];
  reconciled: ImpulsaOpportunityRecord[];
  autoAssignedCount: number;
  skippedByRiskCount: number;
  customersAnalyzed: number;
  loansAnalyzed: number;
}

export function detectImpulsaOpportunities(input: DetectImpulsaInput): DetectImpulsaResult {
  const nowIso = input.nowIso || new Date().toISOString();
  const orgId = input.organizationId;
  const policy = input.policy || DEFAULT_POLICY_V2;
  const cfg = input.config || buildDefaultImpulsaConfig(orgId);

  // Index collections for fast O(1) lookup
  const installmentsByLoan = new Map<string, LoanInstallmentRecord[]>();
  for (const inst of input.loanInstallments) {
    const arr = installmentsByLoan.get(inst.loanId) || [];
    arr.push(inst);
    installmentsByLoan.set(inst.loanId, arr);
  }

  const paymentsByCustomer = new Map<string, PaymentRecord[]>();
  for (const p of input.payments) {
    const arr = paymentsByCustomer.get(p.customerId) || [];
    arr.push(p);
    paymentsByCustomer.set(p.customerId, arr);
  }

  const applicationsByCustomer = new Map<string, ApplicationRecord[]>();
  const applicationsById = new Map<string, ApplicationRecord>();
  for (const app of input.applications) {
    applicationsById.set(app.id, app);
    const arr = applicationsByCustomer.get(app.customerId) || [];
    arr.push(app);
    applicationsByCustomer.set(app.customerId, arr);
  }

  const loansByAppId = new Map<string, LoanRecord>();
  for (const loan of input.loans) {
    if (loan.applicationId) loansByAppId.set(loan.applicationId, loan);
  }

  const collectionAccountsByLoan = new Map<string, CollectionAccountRecord>();
  for (const acc of input.collectionAccounts) {
    collectionAccountsByLoan.set(acc.loanId, acc);
  }

  const riskAlertsByCustomer = new Map<string, RiskAlertRecord[]>();
  for (const alert of input.riskAlerts) {
    const arr = riskAlertsByCustomer.get(alert.customerId) || [];
    arr.push(alert);
    riskAlertsByCustomer.set(alert.customerId, arr);
  }

  const usersById = new Map<string, UserProfile>();
  for (const u of input.users) {
    usersById.set(u.uid, u);
  }

  const commercialOfficers = input.users.filter(
    (u) =>
      u.status === 'ACTIVE' &&
      (u.role === 'BUSINESS_OFFICER' || u.role === 'ADMIN' || u.role === 'MANAGEMENT')
  );

  // Build existing lookup by sourceKey and track officer workload for balanced round-robin
  const existingBySourceKey = new Map<string, ImpulsaOpportunityRecord>();
  const officerLoad = new Map<string, number>();
  for (const off of commercialOfficers) officerLoad.set(off.uid, 0);

  for (const opp of input.existingOpportunities) {
    existingBySourceKey.set(opp.sourceKey, opp);
    if (
      opp.assignedOfficerId &&
      !TERMINAL_IMPULSA_STATUSES.has(opp.status) &&
      officerLoad.has(opp.assignedOfficerId)
    ) {
      officerLoad.set(opp.assignedOfficerId, (officerLoad.get(opp.assignedOfficerId) || 0) + 1);
    }
  }

  const created: ImpulsaOpportunityRecord[] = [];
  const updated: ImpulsaOpportunityRecord[] = [];
  const reconciled: ImpulsaOpportunityRecord[] = [];
  let autoAssignedCount = 0;
  let skippedByRiskCount = 0;

  const chooseOfficer = (
    profile: CustomerFinancialProfile
  ): { officerId: string | null; officerName: string | null } => {
    if (cfg.assignmentStrategy === 'MANUAL_ONLY' || commercialOfficers.length === 0) {
      return { officerId: null, officerName: null };
    }
    if (cfg.assignmentStrategy === 'LOAN_OWNER_FIRST' && profile.knownOfficerId) {
      const owner = usersById.get(profile.knownOfficerId);
      if (owner && owner.status === 'ACTIVE' && owner.role !== 'EXTERNAL_CLIENT') {
        officerLoad.set(owner.uid, (officerLoad.get(owner.uid) || 0) + 1);
        return { officerId: owner.uid, officerName: owner.displayName || owner.email };
      }
    }
    // Round-robin by lowest active load
    let best = commercialOfficers[0];
    let bestLoad = officerLoad.get(best.uid) ?? 0;
    for (const off of commercialOfficers) {
      const load = officerLoad.get(off.uid) ?? 0;
      if (load < bestLoad) {
        best = off;
        bestLoad = load;
      }
    }
    officerLoad.set(best.uid, bestLoad + 1);
    return { officerId: best.uid, officerName: best.displayName || best.email };
  };

  const upsertCandidate = (
    draft: Omit<
      ImpulsaOpportunityRecord,
      | 'id'
      | 'opportunityCode'
      | 'status'
      | 'assignedOfficerId'
      | 'assignedOfficerName'
      | 'assignedAtIso'
      | 'assignedBy'
      | 'followUpHistory'
      | 'detectedAtIso'
      | 'createdBy'
    >,
    profile: CustomerFinancialProfile
  ) => {
    const existing = existingBySourceKey.get(draft.sourceKey);
    if (existing) {
      // Preserve terminal states and officer CRM workflow; refresh analytical metrics
      if (TERMINAL_IMPULSA_STATUSES.has(existing.status)) {
        return;
      }
      const merged: ImpulsaOpportunityRecord = {
        ...existing,
        ...draft,
        id: existing.id,
        opportunityCode: existing.opportunityCode,
        status: existing.status,
        assignedOfficerId: existing.assignedOfficerId ?? null,
        assignedOfficerName: existing.assignedOfficerName ?? null,
        assignedAtIso: existing.assignedAtIso ?? null,
        assignedBy: existing.assignedBy ?? null,
        lastContactAtIso: existing.lastContactAtIso ?? null,
        lastOutcome: existing.lastOutcome ?? null,
        nextFollowUpDate: existing.nextFollowUpDate ?? null,
        followUpHistory: existing.followUpHistory || [],
        linkedApplicationId: existing.linkedApplicationId ?? null,
        linkedApplicationNumber: existing.linkedApplicationNumber ?? null,
        linkedApplicationStatus: existing.linkedApplicationStatus ?? null,
        linkedLoanId: existing.linkedLoanId ?? null,
        linkedLoanNumber: existing.linkedLoanNumber ?? null,
        disbursedAmount: existing.disbursedAmount ?? null,
        convertedAtIso: existing.convertedAtIso ?? null,
        convertedBy: existing.convertedBy ?? null,
        detectedAtIso: existing.detectedAtIso,
        createdBy: existing.createdBy,
        lastEvaluatedAtIso: nowIso,
      };
      existingBySourceKey.set(draft.sourceKey, merged);
      updated.push(merged);
      return;
    }

    const assigned = chooseOfficer(profile);
    if (assigned.officerId) autoAssignedCount += 1;
    const initialStatus: ImpulsaOpportunityStatus = assigned.officerId
      ? 'ASIGNADA'
      : cfg.assignmentStrategy === 'MANUAL_ONLY'
      ? 'PENDIENTE_ASIGNACION'
      : 'DETECTADA';

    const oppId = `imp_${draft.sourceKey.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 64)}`;
    const record: ImpulsaOpportunityRecord = {
      ...draft,
      id: oppId,
      opportunityCode: buildOpportunityCode(draft.category, draft.customerId, draft.sourceLoanId),
      status: initialStatus,
      assignedOfficerId: assigned.officerId,
      assignedOfficerName: assigned.officerName,
      assignedAtIso: assigned.officerId ? nowIso : null,
      assignedBy: assigned.officerId ? 'IMPULSA_AUTO' : null,
      assignmentLockReason: assigned.officerId
        ? 'Asignación exclusiva de Impulsa para evitar contacto duplicado.'
        : null,
      followUpHistory: [],
      detectedAtIso: nowIso,
      lastEvaluatedAtIso: nowIso,
      windowExpiresAtIso: addDaysIso(nowIso, cfg.opportunityWindowDays),
      createdBy: input.actorId || 'IMPULSA_ENGINE',
    };
    existingBySourceKey.set(draft.sourceKey, record);
    created.push(record);
  };

  // 1) Reconcile existing opportunities linked to applications or loans
  for (const existing of existingBySourceKey.values()) {
    if (!existing.linkedApplicationId) continue;
    const linkedApp = applicationsById.get(existing.linkedApplicationId);
    if (!linkedApp) continue;
    const linkedLoan = loansByAppId.get(linkedApp.id);

    let targetStatus: ImpulsaOpportunityStatus = existing.status;
    let disbursedAmount = existing.disbursedAmount ?? null;
    let linkedLoanId = existing.linkedLoanId ?? null;
    let linkedLoanNumber = existing.linkedLoanNumber ?? null;

    if (linkedApp.status === 'DESEMBOLSADA' || linkedLoan) {
      targetStatus = 'DESEMBOLSADA';
      linkedLoanId = linkedLoan?.id || linkedLoanId;
      linkedLoanNumber = linkedLoan?.loanNumber || linkedLoanNumber;
      disbursedAmount =
        linkedLoan?.approvedPrincipal ??
        linkedLoan?.totalFinancedPrincipal ??
        linkedApp.requestedAmount;
    } else if (
      linkedApp.status === 'APROBADA' ||
      linkedApp.status === 'APROBADA_CONDICIONADA' ||
      linkedApp.status === 'FORMALIZADA'
    ) {
      targetStatus = 'APROBADA';
    } else if (
      linkedApp.status === 'EN_EVALUACION' ||
      linkedApp.status === 'EN_COMITE' ||
      linkedApp.status === 'RECIBIDA'
    ) {
      targetStatus = 'EN_EVALUACION';
    } else if (linkedApp.status === 'RECHAZADA') {
      targetStatus = 'DESCARTADA';
    }

    if (
      targetStatus !== existing.status ||
      existing.linkedApplicationStatus !== linkedApp.status ||
      linkedLoanId !== (existing.linkedLoanId ?? null)
    ) {
      const synced: ImpulsaOpportunityRecord = {
        ...existing,
        status: targetStatus,
        linkedApplicationStatus: linkedApp.status,
        linkedLoanId,
        linkedLoanNumber,
        disbursedAmount,
        lastEvaluatedAtIso: nowIso,
      };
      existingBySourceKey.set(existing.sourceKey, synced);
      reconciled.push(synced);
    }
  }

  // 2) Scan every real customer & loan across all 7 opportunity categories
  for (const customer of input.customers) {
    const profile = computeCustomerProfile({
      customer,
      businesses: input.businesses,
      loans: input.loans,
      installmentsByLoan,
      paymentsByCustomer,
      applicationsByCustomer,
      collectionAccountsByLoan,
      riskAlertsByCustomer,
      policy,
      usersById,
    });

    if (profile.loans.length === 0) {
      // Customers with zero credit history don't trigger portfolio-based retention/renewal detectors
      continue;
    }

    const baseRisks: ImpulsaRiskSignal[] = [];
    for (const alert of profile.openCentinelaAlerts) {
      baseRisks.push({
        severity: alert.severity === 'CRITICA' ? 'BLOCKER' : 'WARNING',
        source: 'CENTINELA',
        detail: `Alerta Centinela (${alert.severity}): ${alert.title} — ${alert.metricValue}`,
      });
    }
    if (profile.hasActiveApplication) {
      baseRisks.push({
        severity: 'WARNING',
        source: 'SOLICITUD',
        detail: 'El cliente ya tiene una solicitud activa en trámite en AxyCore.',
      });
    }

    const commercialBlockedByCentinela =
      cfg.blockCommercialOffersOnCriticalCentinela && profile.hasCriticalCentinelaAlert;

    // --- DETECTORS OVER ACTIVE LOANS ---
    for (const loan of profile.activeLoans) {
      const insts = installmentsByLoan.get(loan.id) || [];
      const paidInsts = insts.filter((i) => i.status === 'PAGADA');
      const unpaidInsts = insts.filter((i) => i.status !== 'PAGADA');
      const totalInstCount = Math.max(insts.length, 1);
      const remainingInstCount = unpaidInsts.length;
      const principalBase = Math.max(1, loan.totalFinancedPrincipal || loan.approvedPrincipal);
      const paidPrincipal = Math.max(
        0,
        round2(
          loan.paidPrincipalTotal ??
            principalBase - Math.max(0, loan.currentPrincipalBalance || 0)
        )
      );
      const paidRatioPct = round2(clamp((paidPrincipal / principalBase) * 100, 0, 100));
      const acc = collectionAccountsByLoan.get(loan.id);
      const loanDpd = Number(acc?.dpd || 0);
      const loanMaxDpd = Math.max(Number(acc?.maxHistoricalDpd || 0), loanDpd);
      const productCfg =
        policy.products?.[loan.productCode] || DEFAULT_POLICY_V2.products[loan.productCode];

      const currentLoanMonthlyEquiv = (() => {
        const sample = unpaidInsts[0] || insts[0];
        if (sample) return sample.totalAmount * getPeriodsPerMonth(loan.frequency);
        const rPct =
          loan.contractualRateMonthly <= 1
            ? loan.contractualRateMonthly * 100
            : loan.contractualRateMonthly;
        return estimateMonthlyInstallment(principalBase, rPct, Math.max(1, loan.termMonths));
      })();

      // 1. RENOVACIÓN ANTICIPADA
      const qualifiesEarlyRenewal =
        !commercialBlockedByCentinela &&
        loanDpd <= cfg.earlyRenewalMaxDpd &&
        (remainingInstCount <= cfg.earlyRenewalMaxRemainingInstallments ||
          paidRatioPct >= cfg.earlyRenewalMinPaidRatioPct) &&
        loan.currentPrincipalBalance > 0;

      if (qualifiesEarlyRenewal) {
        const offer = validateAndBoundOffer({
          policy,
          productCode: loan.productCode,
          rawAmount: Math.max(loan.approvedPrincipal, loan.approvedPrincipal * 1.1),
          rawTermMonths: loan.termMonths,
          profile,
          replacesCurrentLoanMonthlyPayment: currentLoanMonthlyEquiv,
        });

        const score = clamp(
          Math.round(
            58 +
              (remainingInstCount <= 2 ? 20 : 12) +
              (paidRatioPct >= 80 ? 12 : 6) +
              (loanMaxDpd === 0 ? 10 : 0) -
              (profile.hasActiveApplication ? 15 : 0)
          ),
          25,
          98
        );

        const convProb = clamp(
          Math.round(
            48 +
              (remainingInstCount <= 2 ? 22 : 12) +
              (loanMaxDpd === 0 ? 14 : 4) +
              (profile.closedLoans.length > 0 ? 8 : 0)
          ),
          20,
          92
        );

        const risks = [...baseRisks];
        if (!offer.policyCompliant) {
          risks.push({
            severity: 'WARNING',
            source: 'CAPACIDAD',
            detail: offer.policyNotes.join(' '),
          });
        }

        upsertCandidate(
          {
            organizationId: orgId,
            sourceKey: buildSourceKey(orgId, customer.id, 'RENOVACION_ANTICIPADA', loan.id),
            customerId: customer.id,
            customerName: profile.customerName,
            customerDocument: customer.documentNumber,
            customerPhone: customer.phone,
            customerEmail: customer.email,
            branchOrProvince: profile.branchOrProvince,
            category: 'RENOVACION_ANTICIPADA',
            priority: computePriority(score),
            priorityScore: score,
            commercialConversionProbability: convProb,
            confidenceScore: profile.monthlyIncome > 0 ? 92 : 76,
            sourceLoanId: loan.id,
            sourceLoanNumber: loan.loanNumber,
            sourceProductCode: loan.productCode,
            currency: loan.currency,
            currentLoanBalance: round2(loan.currentPrincipalBalance),
            previousPrincipalAmount: round2(loan.approvedPrincipal),
            paidPrincipalAmount: paidPrincipal,
            remainingInstallments: remainingInstCount,
            totalInstallments: totalInstCount,
            estimatedMaturityDate: loan.maturityDate,
            currentDpd: loanDpd,
            maxHistoricalDpd: loanMaxDpd,
            earlyPaymentsCount: profile.earlyPaymentsCount,
            completedLoansCount: profile.closedLoans.length,
            daysSinceLastClosedLoan: null,
            latestBehaviorScore: acc?.behaviorScore ?? profile.averageBehaviorScore,
            latestOriginationScore: profile.latestOriginationScore,
            recommendedProductCode: loan.productCode,
            recommendedProductLabel: productCfg.label,
            suggestedAmount: offer.amount,
            suggestedTermMonths: offer.termMonths,
            suggestedFrequency: loan.frequency,
            estimatedMonthlyRatePct: offer.ratePct,
            estimatedInstallment: offer.installment,
            estimatedNetProfit: offer.netProfit,
            estimatedPaymentCapacity: profile.availableMonthlyFlow,
            estimatedCurrentDtiPct: profile.currentDtiPct,
            estimatedProjectedDtiPct: offer.projectedDtiPct,
            policyCompliant: offer.policyCompliant,
            policyNotes: offer.policyNotes,
            summaryReason: `Préstamo ${loan.loanNumber} al ${paidRatioPct}% amortizado (${remainingInstCount} cuota(s) restante(s)) con ${loanDpd} días de atraso actual.`,
            detailedReasons: [
              `Ha pagado ${formatMoney(paidPrincipal, loan.currency)} de capital (${paidRatioPct}% del principal financiado).`,
              `Quedan ${remainingInstCount} de ${totalInstCount} cuotas por vencer (vencimiento estimado: ${loan.maturityDate}).`,
              `Comportamiento actual al día (${loanDpd} días de mora; máximo histórico ${loanMaxDpd} días).`,
              'Contactar antes del cierre reduce fuga hacia competidores y sostiene el saldo productivo.',
            ],
            evidenceMetrics: [
              { label: 'Saldo pendiente', value: formatMoney(loan.currentPrincipalBalance, loan.currency), source: `Préstamo ${loan.loanNumber}` },
              { label: 'Capital amortizado', value: `${paidRatioPct}%`, source: 'Cuotas aplicadas' },
              { label: 'Cuotas restantes', value: `${remainingInstCount} / ${totalInstCount}`, source: 'Tabla de amortización' },
              { label: 'Atraso actual / máx.', value: `${loanDpd}d / ${loanMaxDpd}d`, source: 'Cobranza AxyCore' },
            ],
            risksIdentified: risks,
            centinelaAlertsCount: profile.openCentinelaAlerts.length,
            nextRecommendedAction:
              'Contactar al cliente con oferta de renovación anticipada, actualizar comprobante de ingresos y convertir en solicitud para evaluación V2.',
            creditApprovalDisclaimer: COMMERCIAL_DISCLAIMER,
            lastEvaluatedAtIso: nowIso,
          },
          profile
        );
      } else if (commercialBlockedByCentinela && remainingInstCount <= cfg.earlyRenewalMaxRemainingInstallments) {
        skippedByRiskCount += 1;
      }

      // 3. CRECIMIENTO CREDITICIO (Validando capacidad de pago y política vigente)
      const qualifiesGrowth =
        !commercialBlockedByCentinela &&
        loanDpd === 0 &&
        loanMaxDpd <= cfg.excellentBehaviorMaxHistoricalDpd &&
        paidRatioPct >= cfg.growthMinPaidRatioPct &&
        profile.monthlyIncome > 0;

      if (qualifiesGrowth) {
        const targetGrowthAmount = loan.approvedPrincipal * cfg.growthMaxIncreaseFactor;
        const offer = validateAndBoundOffer({
          policy,
          productCode: loan.productCode,
          rawAmount: targetGrowthAmount,
          rawTermMonths: Math.min(productCfg.maxTermMonths, Math.max(loan.termMonths, 12)),
          profile,
          replacesCurrentLoanMonthlyPayment: currentLoanMonthlyEquiv,
        });

        // Only recommend credit growth when validated capacity actually supports >10% above previous loan AND complies with policy
        if (offer.policyCompliant && offer.amount >= loan.approvedPrincipal * 1.1) {
          const increasePct = round2(
            ((offer.amount - loan.approvedPrincipal) / Math.max(1, loan.approvedPrincipal)) * 100
          );
          const score = clamp(
            Math.round(
              56 +
                (increasePct >= 25 ? 16 : 10) +
                (paidRatioPct >= 60 ? 12 : 6) +
                ((profile.latestOriginationScore || 70) >= 80 ? 10 : 4)
            ),
            35,
            95
          );
          const convProb = clamp(Math.round(45 + (paidRatioPct >= 60 ? 18 : 10) + 12), 25, 88);

          upsertCandidate(
            {
              organizationId: orgId,
              sourceKey: buildSourceKey(orgId, customer.id, 'CRECIMIENTO_CREDITICIO', loan.id),
              customerId: customer.id,
              customerName: profile.customerName,
              customerDocument: customer.documentNumber,
              customerPhone: customer.phone,
              customerEmail: customer.email,
              branchOrProvince: profile.branchOrProvince,
              category: 'CRECIMIENTO_CREDITICIO',
              priority: computePriority(score),
              priorityScore: score,
              commercialConversionProbability: convProb,
              confidenceScore: 90,
              sourceLoanId: loan.id,
              sourceLoanNumber: loan.loanNumber,
              sourceProductCode: loan.productCode,
              currency: loan.currency,
              currentLoanBalance: round2(loan.currentPrincipalBalance),
              previousPrincipalAmount: round2(loan.approvedPrincipal),
              paidPrincipalAmount: paidPrincipal,
              remainingInstallments: remainingInstCount,
              totalInstallments: totalInstCount,
              estimatedMaturityDate: loan.maturityDate,
              currentDpd: loanDpd,
              maxHistoricalDpd: loanMaxDpd,
              earlyPaymentsCount: profile.earlyPaymentsCount,
              completedLoansCount: profile.closedLoans.length,
              daysSinceLastClosedLoan: null,
              latestBehaviorScore: acc?.behaviorScore ?? profile.averageBehaviorScore,
              latestOriginationScore: profile.latestOriginationScore,
              recommendedProductCode: loan.productCode,
              recommendedProductLabel: productCfg.label,
              suggestedAmount: offer.amount,
              suggestedTermMonths: offer.termMonths,
              suggestedFrequency: loan.frequency,
              estimatedMonthlyRatePct: offer.ratePct,
              estimatedInstallment: offer.installment,
              estimatedNetProfit: offer.netProfit,
              estimatedPaymentCapacity: profile.availableMonthlyFlow,
              estimatedCurrentDtiPct: profile.currentDtiPct,
              estimatedProjectedDtiPct: offer.projectedDtiPct,
              policyCompliant: offer.policyCompliant,
              policyNotes: offer.policyNotes,
              summaryReason: `Capacidad verificada soporta incremento responsable de +${increasePct}% (de ${formatMoney(
                loan.approvedPrincipal,
                loan.currency
              )} a ${formatMoney(offer.amount, loan.currency)}) respetando DTI vigente.`,
              detailedReasons: [
                `Crédito actual ${loan.loanNumber} al día (0 días de atraso, máx. histórico ${loanMaxDpd} días) y ${paidRatioPct}% pagado.`,
                `Flujo mensual disponible estimado: ${formatMoney(
                  profile.availableMonthlyFlow,
                  profile.incomeCurrency
                )}; DTI proyectado ${offer.projectedDtiPct ?? 0}% dentro del tope de política.`,
                `Aumento sugerido validado contra límites de ${productCfg.label} sin sobreendeudar al cliente.`,
              ],
              evidenceMetrics: [
                { label: 'Monto anterior', value: formatMoney(loan.approvedPrincipal, loan.currency), source: loan.loanNumber },
                { label: 'Monto sugerido', value: formatMoney(offer.amount, loan.currency), source: 'Cálculo capacidad Impulsa' },
                { label: 'Ingreso mensual base', value: formatMoney(profile.monthlyIncome, profile.incomeCurrency), source: 'Expediente crediticio' },
                { label: 'DTI proyectado', value: `${offer.projectedDtiPct ?? 'N/D'}%`, source: 'Política activa' },
              ],
              risksIdentified: baseRisks,
              centinelaAlertsCount: profile.openCentinelaAlerts.length,
              nextRecommendedAction:
                'Validar estabilidad actual de ingresos con el cliente y presentar propuesta de ampliación sujeta a Motor V2.',
              creditApprovalDisclaimer: COMMERCIAL_DISCLAIMER,
              lastEvaluatedAtIso: nowIso,
            },
            profile
          );
        }
      }

      // 7. REFINANCIAMIENTO RESPONSABLE (Solo para clientes con tensión temprana/moderada + capacidad demostrable; NUNCA ocultar mora crónica)
      const qualifiesResponsibleRefi =
        loanDpd >= cfg.refinancingMinDpd &&
        loanDpd <= cfg.refinancingMaxDpd &&
        paidRatioPct >= cfg.refinancingMinPaidRatioPct &&
        !acc?.isRestructured &&
        loan.currentPrincipalBalance > 0;

      if (qualifiesResponsibleRefi) {
        const extendedTerm = Math.min(
          productCfg.maxTermMonths,
          Math.max(loan.termMonths + 6, Math.ceil(loan.termMonths * 1.4))
        );
        const offer = validateAndBoundOffer({
          policy,
          productCode: loan.productCode,
          rawAmount: loan.currentPrincipalBalance,
          rawTermMonths: extendedTerm,
          profile,
          replacesCurrentLoanMonthlyPayment: currentLoanMonthlyEquiv,
        });

        const installmentReliefPct =
          currentLoanMonthlyEquiv > 0
            ? round2(((currentLoanMonthlyEquiv - offer.installment) / currentLoanMonthlyEquiv) * 100)
            : 0;

        // Only propose if it genuinely lowers monthly burden AND respects capacity/policy
        if (installmentReliefPct >= 10 && offer.policyCompliant) {
          const score = clamp(
            Math.round(62 + (loanDpd >= 15 ? 16 : 8) + (installmentReliefPct >= 20 ? 10 : 4)),
            40,
            90
          );
          const refiRisks: ImpulsaRiskSignal[] = [
            ...baseRisks,
            {
              severity: 'WARNING',
              source: 'COBRANZA',
              detail: `Atraso vigente de ${loanDpd} días. Requiere validación de causa de liquidez y dictamen de riesgo; prohibido refinanciar para maquillar morosidad.`,
            },
          ];

          upsertCandidate(
            {
              organizationId: orgId,
              sourceKey: buildSourceKey(orgId, customer.id, 'REFINANCIAMIENTO_RESPONSABLE', loan.id),
              customerId: customer.id,
              customerName: profile.customerName,
              customerDocument: customer.documentNumber,
              customerPhone: customer.phone,
              customerEmail: customer.email,
              branchOrProvince: profile.branchOrProvince,
              category: 'REFINANCIAMIENTO_RESPONSABLE',
              priority: computePriority(score),
              priorityScore: score,
              commercialConversionProbability: clamp(Math.round(52 + installmentReliefPct * 0.6), 30, 82),
              confidenceScore: profile.monthlyIncome > 0 ? 85 : 68,
              sourceLoanId: loan.id,
              sourceLoanNumber: loan.loanNumber,
              sourceProductCode: loan.productCode,
              currency: loan.currency,
              currentLoanBalance: round2(loan.currentPrincipalBalance),
              previousPrincipalAmount: round2(loan.approvedPrincipal),
              paidPrincipalAmount: paidPrincipal,
              remainingInstallments: remainingInstCount,
              totalInstallments: totalInstCount,
              estimatedMaturityDate: loan.maturityDate,
              currentDpd: loanDpd,
              maxHistoricalDpd: loanMaxDpd,
              earlyPaymentsCount: profile.earlyPaymentsCount,
              completedLoansCount: profile.closedLoans.length,
              daysSinceLastClosedLoan: null,
              latestBehaviorScore: acc?.behaviorScore ?? profile.averageBehaviorScore,
              latestOriginationScore: profile.latestOriginationScore,
              recommendedProductCode: loan.productCode,
              recommendedProductLabel: productCfg.label,
              suggestedAmount: offer.amount,
              suggestedTermMonths: offer.termMonths,
              suggestedFrequency: loan.frequency,
              estimatedMonthlyRatePct: offer.ratePct,
              estimatedInstallment: offer.installment,
              estimatedNetProfit: offer.netProfit,
              estimatedPaymentCapacity: profile.availableMonthlyFlow,
              estimatedCurrentDtiPct: profile.currentDtiPct,
              estimatedProjectedDtiPct: offer.projectedDtiPct,
              policyCompliant: offer.policyCompliant,
              policyNotes: [
                ...offer.policyNotes,
                'Refinanciamiento responsable sobre saldo insoluto actual sin desembolso incremental no respaldado.',
              ],
              summaryReason: `Préstamo ${loan.loanNumber} con ${loanDpd} días de atraso y ${paidRatioPct}% amortizado; reperfilar a ${offer.termMonths}m aliviaría la cuota en ~${installmentReliefPct}%.`,
              detailedReasons: [
                `El cliente ya demostró voluntad de pago amortizando ${paidRatioPct}% del capital original.`,
                `Atraso en ventana recuperable (${loanDpd} días, dentro del límite prudencial de ${cfg.refinancingMaxDpd} días).`,
                `Ajuste de plazo a ${offer.termMonths} meses reduciría carga mensual estimada en ${installmentReliefPct}% sin incrementar capital.`,
              ],
              evidenceMetrics: [
                { label: 'Saldo a reperfilar', value: formatMoney(loan.currentPrincipalBalance, loan.currency), source: loan.loanNumber },
                { label: 'Días de atraso', value: `${loanDpd} días`, source: 'Cobranza' },
                { label: 'Alivio estimado de cuota', value: `-${installmentReliefPct}%`, source: 'Simulación Impulsa' },
                { label: 'Capital amortizado', value: `${paidRatioPct}%`, source: 'Historial de pagos' },
              ],
              risksIdentified: refiRisks,
              centinelaAlertsCount: profile.openCentinelaAlerts.length,
              nextRecommendedAction:
                'Coordinar entrevista de diagnóstico financiero con Riesgos/Cobranza para confirmar capacidad real antes de someter solicitud.',
              creditApprovalDisclaimer: COMMERCIAL_DISCLAIMER,
              lastEvaluatedAtIso: nowIso,
            },
            profile
          );
        }
      }
    }

    // --- PORTFOLIO / CUSTOMER-LEVEL DETECTORS ---

    // 2. CLIENTES CON EXCELENTE COMPORTAMIENTO
    const totalPaidInstAll = profile.loans.reduce(
      (sum, l) => sum + (installmentsByLoan.get(l.id) || []).filter((i) => i.status === 'PAGADA').length,
      0
    );
    const qualifiesExcellent =
      !commercialBlockedByCentinela &&
      profile.currentMaxDpd === 0 &&
      profile.maxHistoricalDpd <= cfg.excellentBehaviorMaxHistoricalDpd &&
      (totalPaidInstAll >= cfg.excellentBehaviorMinPaidInstallments || profile.closedLoans.length >= 1) &&
      (profile.averageBehaviorScore === null || profile.averageBehaviorScore >= 75);

    if (qualifiesExcellent) {
      const refLoan = profile.activeLoans[0] || profile.closedLoans[0];
      const productCode = refLoan.productCode;
      const productCfg = policy.products?.[productCode] || DEFAULT_POLICY_V2.products[productCode];
      const offer = validateAndBoundOffer({
        policy,
        productCode,
        rawAmount: refLoan.approvedPrincipal,
        rawTermMonths: refLoan.termMonths,
        profile,
      });

      const score = clamp(
        Math.round(
          54 +
            (profile.maxHistoricalDpd === 0 ? 18 : 8) +
            (profile.closedLoans.length >= 1 ? 12 : 6) +
            (profile.onTimePaymentsRatioPct >= 95 ? 10 : 4)
        ),
        35,
        94
      );

      upsertCandidate(
        {
          organizationId: orgId,
          sourceKey: buildSourceKey(orgId, customer.id, 'EXCELENTE_COMPORTAMIENTO', null),
          customerId: customer.id,
          customerName: profile.customerName,
          customerDocument: customer.documentNumber,
          customerPhone: customer.phone,
          customerEmail: customer.email,
          branchOrProvince: profile.branchOrProvince,
          category: 'EXCELENTE_COMPORTAMIENTO',
          priority: computePriority(score),
          priorityScore: score,
          commercialConversionProbability: clamp(Math.round(50 + profile.closedLoans.length * 10 + 10), 30, 86),
          confidenceScore: 90,
          sourceLoanId: refLoan.id,
          sourceLoanNumber: refLoan.loanNumber,
          sourceProductCode: productCode,
          currency: refLoan.currency,
          currentLoanBalance: round2(
            profile.activeLoans.reduce((s, l) => s + Number(l.currentPrincipalBalance || 0), 0)
          ),
          previousPrincipalAmount: round2(refLoan.approvedPrincipal),
          paidPrincipalAmount: round2(
            profile.loans.reduce((s, l) => s + Number(l.paidPrincipalTotal || 0), 0)
          ),
          remainingInstallments: profile.activeLoans.reduce(
            (s, l) => s + (installmentsByLoan.get(l.id) || []).filter((i) => i.status !== 'PAGADA').length,
            0
          ),
          totalInstallments: totalPaidInstAll,
          estimatedMaturityDate: refLoan.maturityDate,
          currentDpd: 0,
          maxHistoricalDpd: profile.maxHistoricalDpd,
          earlyPaymentsCount: profile.earlyPaymentsCount,
          completedLoansCount: profile.closedLoans.length,
          daysSinceLastClosedLoan: null,
          latestBehaviorScore: profile.averageBehaviorScore,
          latestOriginationScore: profile.latestOriginationScore,
          recommendedProductCode: productCode,
          recommendedProductLabel: productCfg.label,
          suggestedAmount: offer.amount,
          suggestedTermMonths: offer.termMonths,
          suggestedFrequency: refLoan.frequency,
          estimatedMonthlyRatePct: offer.ratePct,
          estimatedInstallment: offer.installment,
          estimatedNetProfit: offer.netProfit,
          estimatedPaymentCapacity: profile.availableMonthlyFlow,
          estimatedCurrentDtiPct: profile.currentDtiPct,
          estimatedProjectedDtiPct: offer.projectedDtiPct,
          policyCompliant: offer.policyCompliant,
          policyNotes: offer.policyNotes,
          summaryReason: `Historial impecable (${profile.onTimePaymentsRatioPct}% puntualidad, máx. atraso ${profile.maxHistoricalDpd}d, ${profile.closedLoans.length} crédito(s) cerrado(s)).`,
          detailedReasons: [
            `Cumplimiento sobresaliente en ${totalPaidInstAll} cuota(s) pagada(s) y ${profile.closedLoans.length} crédito(s) cancelado(s).`,
            `Score de comportamiento interno: ${profile.averageBehaviorScore ?? 'Sin incidencias'} y 0 días de mora actual.`,
            'Perfil ideal para fidelización preferencial, renovación ágil o línea complementaria validada.',
          ],
          evidenceMetrics: [
            { label: 'Puntualidad', value: `${profile.onTimePaymentsRatioPct}%`, source: 'Cuotas pagadas' },
            { label: 'Máx. atraso histórico', value: `${profile.maxHistoricalDpd} días`, source: 'Cobranza' },
            { label: 'Créditos liquidados', value: `${profile.closedLoans.length}`, source: 'Cartera histórica' },
            { label: 'Score comportamiento', value: `${profile.averageBehaviorScore ?? 'N/D'}`, source: 'AxyCore Cobranza' },
          ],
          risksIdentified: baseRisks,
          centinelaAlertsCount: profile.openCentinelaAlerts.length,
          nextRecommendedAction:
            'Realizar llamada de fidelización para explorar necesidades de financiamiento actuales y validar interés.',
          creditApprovalDisclaimer: COMMERCIAL_DISCLAIMER,
          lastEvaluatedAtIso: nowIso,
        },
        profile
      );
    }

    // 4. PAGOS ANTICIPADOS (Sin asumir necesidad de endeudarse)
    const qualifiesEarlyPayments =
      !commercialBlockedByCentinela &&
      profile.currentMaxDpd === 0 &&
      profile.earlyPaymentsCount >= cfg.earlyPaymentMinCount;

    if (qualifiesEarlyPayments) {
      const refLoan = profile.activeLoans[0] || profile.closedLoans[0];
      const productCode = refLoan.productCode;
      const productCfg = policy.products?.[productCode] || DEFAULT_POLICY_V2.products[productCode];
      const offer = validateAndBoundOffer({
        policy,
        productCode,
        rawAmount: refLoan.approvedPrincipal,
        rawTermMonths: refLoan.termMonths,
        profile,
      });

      const score = clamp(Math.round(52 + Math.min(24, profile.earlyPaymentsCount * 6)), 38, 86);
      upsertCandidate(
        {
          organizationId: orgId,
          sourceKey: buildSourceKey(orgId, customer.id, 'PAGO_ANTICIPADO', refLoan.id),
          customerId: customer.id,
          customerName: profile.customerName,
          customerDocument: customer.documentNumber,
          customerPhone: customer.phone,
          customerEmail: customer.email,
          branchOrProvince: profile.branchOrProvince,
          category: 'PAGO_ANTICIPADO',
          priority: computePriority(score),
          priorityScore: score,
          commercialConversionProbability: 44, // Conservative: liquidity does not imply borrowing intent
          confidenceScore: 84,
          sourceLoanId: refLoan.id,
          sourceLoanNumber: refLoan.loanNumber,
          sourceProductCode: productCode,
          currency: refLoan.currency,
          currentLoanBalance: round2(refLoan.currentPrincipalBalance),
          previousPrincipalAmount: round2(refLoan.approvedPrincipal),
          paidPrincipalAmount: round2(refLoan.paidPrincipalTotal || 0),
          remainingInstallments: (installmentsByLoan.get(refLoan.id) || []).filter(
            (i) => i.status !== 'PAGADA'
          ).length,
          totalInstallments: (installmentsByLoan.get(refLoan.id) || []).length,
          estimatedMaturityDate: refLoan.maturityDate,
          currentDpd: 0,
          maxHistoricalDpd: profile.maxHistoricalDpd,
          earlyPaymentsCount: profile.earlyPaymentsCount,
          completedLoansCount: profile.closedLoans.length,
          daysSinceLastClosedLoan: null,
          latestBehaviorScore: profile.averageBehaviorScore,
          latestOriginationScore: profile.latestOriginationScore,
          recommendedProductCode: productCode,
          recommendedProductLabel: productCfg.label,
          suggestedAmount: offer.amount,
          suggestedTermMonths: offer.termMonths,
          suggestedFrequency: refLoan.frequency,
          estimatedMonthlyRatePct: offer.ratePct,
          estimatedInstallment: offer.installment,
          estimatedNetProfit: offer.netProfit,
          estimatedPaymentCapacity: profile.availableMonthlyFlow,
          estimatedCurrentDtiPct: profile.currentDtiPct,
          estimatedProjectedDtiPct: offer.projectedDtiPct,
          policyCompliant: offer.policyCompliant,
          policyNotes: [
            ...offer.policyNotes,
            'Nota comercial: Liquidez anticipada no implica deseo inmediato de endeudamiento; enfoque consultivo de fidelización.',
          ],
          summaryReason: `Registró ${profile.earlyPaymentsCount} pago(s) o cancelación(es) antes del vencimiento, reflejando disciplina y liquidez saludable.`,
          detailedReasons: [
            `Se identificaron ${profile.earlyPaymentsCount} eventos de pago anticipado sobre calendario contractual.`,
            'No se asume intención automática de deuda: recomendar contacto consultivo de relación y disponibilidad de línea ágil.',
          ],
          evidenceMetrics: [
            { label: 'Pagos anticipados', value: `${profile.earlyPaymentsCount}`, source: 'Fechas de pago vs vencimiento' },
            { label: 'Atraso actual', value: '0 días', source: 'Cobranza' },
            { label: 'Préstamo referencia', value: refLoan.loanNumber, source: 'Cartera' },
          ],
          risksIdentified: [
            ...baseRisks,
            {
              severity: 'INFO',
              source: 'CAPACIDAD',
              detail: 'Cliente con liquidez: evitar presión comercial y ofrecer acompañamiento consultivo.',
            },
          ],
          centinelaAlertsCount: profile.openCentinelaAlerts.length,
          nextRecommendedAction:
            'Enviar contacto consultivo agradeciendo su puntualidad e indagar si proyecta nuevas metas o inversión.',
          creditApprovalDisclaimer: COMMERCIAL_DISCLAIMER,
          lastEvaluatedAtIso: nowIso,
        },
        profile
      );
    }

    // 5. CLIENTES ANTIGUOS INACTIVOS
    if (!commercialBlockedByCentinela && profile.activeLoans.length === 0 && profile.closedLoans.length > 0) {
      const lastClosed = [...profile.closedLoans].sort((a, b) =>
        String(b.closedAt || b.maturityDate || '').localeCompare(String(a.closedAt || a.maturityDate || ''))
      )[0];
      const closedDateStr = (lastClosed.closedAt || lastClosed.maturityDate || '').slice(0, 10);
      const daysSinceClose = closedDateStr ? Math.max(0, daysBetween(closedDateStr, nowIso.slice(0, 10))) : 30;

      if (
        daysSinceClose >= cfg.inactiveMinDaysSinceClose &&
        profile.maxHistoricalDpd <= cfg.inactiveMaxHistoricalDpd
      ) {
        const productCode = lastClosed.productCode;
        const productCfg = policy.products?.[productCode] || DEFAULT_POLICY_V2.products[productCode];
        const offer = validateAndBoundOffer({
          policy,
          productCode,
          rawAmount: lastClosed.approvedPrincipal,
          rawTermMonths: lastClosed.termMonths,
          profile,
        });

        const score = clamp(
          Math.round(
            58 +
              (profile.maxHistoricalDpd <= 5 ? 16 : 6) +
              (daysSinceClose >= 45 && daysSinceClose <= 180 ? 12 : 6) +
              (profile.closedLoans.length >= 2 ? 10 : 0)
          ),
          35,
          92
        );

        upsertCandidate(
          {
            organizationId: orgId,
            sourceKey: buildSourceKey(orgId, customer.id, 'CLIENTE_INACTIVO', lastClosed.id),
            customerId: customer.id,
            customerName: profile.customerName,
            customerDocument: customer.documentNumber,
            customerPhone: customer.phone,
            customerEmail: customer.email,
            branchOrProvince: profile.branchOrProvince,
            category: 'CLIENTE_INACTIVO',
            priority: computePriority(score),
            priorityScore: score,
            commercialConversionProbability: clamp(Math.round(42 + (profile.closedLoans.length >= 2 ? 18 : 8)), 25, 78),
            confidenceScore: 88,
            sourceLoanId: lastClosed.id,
            sourceLoanNumber: lastClosed.loanNumber,
            sourceProductCode: productCode,
            currency: lastClosed.currency,
            currentLoanBalance: 0,
            previousPrincipalAmount: round2(lastClosed.approvedPrincipal),
            paidPrincipalAmount: round2(lastClosed.approvedPrincipal),
            remainingInstallments: 0,
            totalInstallments: (installmentsByLoan.get(lastClosed.id) || []).length,
            estimatedMaturityDate: lastClosed.maturityDate,
            currentDpd: 0,
            maxHistoricalDpd: profile.maxHistoricalDpd,
            earlyPaymentsCount: profile.earlyPaymentsCount,
            completedLoansCount: profile.closedLoans.length,
            daysSinceLastClosedLoan: daysSinceClose,
            latestBehaviorScore: profile.averageBehaviorScore,
            latestOriginationScore: profile.latestOriginationScore,
            recommendedProductCode: productCode,
            recommendedProductLabel: productCfg.label,
            suggestedAmount: offer.amount,
            suggestedTermMonths: offer.termMonths,
            suggestedFrequency: lastClosed.frequency,
            estimatedMonthlyRatePct: offer.ratePct,
            estimatedInstallment: offer.installment,
            estimatedNetProfit: offer.netProfit,
            estimatedPaymentCapacity: profile.availableMonthlyFlow,
            estimatedCurrentDtiPct: profile.currentDtiPct,
            estimatedProjectedDtiPct: offer.projectedDtiPct,
            policyCompliant: offer.policyCompliant,
            policyNotes: offer.policyNotes,
            summaryReason: `Liquidó satisfactoriamente ${profile.closedLoans.length} crédito(s) (último cierre hace ${daysSinceClose} días) y actualmente no tiene saldo activo.`,
            detailedReasons: [
              `Último préstamo ${lastClosed.loanNumber} (${formatMoney(lastClosed.approvedPrincipal, lastClosed.currency)}) cerrado satisfactoriamente.`,
              `Máximo atraso histórico: ${profile.maxHistoricalDpd} días (dentro de umbral saludable).`,
              'Oportunidad de reactivación de cliente conocido con menor costo de adquisición y menor riesgo de fraude.',
            ],
            evidenceMetrics: [
              { label: 'Días inactivo', value: `${daysSinceClose} días`, source: 'Fecha de cierre' },
              { label: 'Créditos pagados', value: `${profile.closedLoans.length}`, source: 'Historial cartera' },
              { label: 'Último monto', value: formatMoney(lastClosed.approvedPrincipal, lastClosed.currency), source: lastClosed.loanNumber },
            ],
            risksIdentified: baseRisks,
            centinelaAlertsCount: profile.openCentinelaAlerts.length,
            nextRecommendedAction:
              'Contactar para reactivación comercial, confirmar situación laboral/ingresos actuales y pre-cargar solicitud.',
            creditApprovalDisclaimer: COMMERCIAL_DISCLAIMER,
            lastEvaluatedAtIso: nowIso,
          },
          profile
        );
      }
    }

    // 6. OPORTUNIDADES DE NUEVOS PRODUCTOS (Usando catálogo real vigente en política AxyCore)
    if (!commercialBlockedByCentinela && profile.currentMaxDpd <= 5 && profile.maxHistoricalDpd <= 10) {
      const existingProducts = new Set<ProductCode>(profile.loans.map((l) => l.productCode));
      let suggestedNewProduct: ProductCode | null = null;
      let crossSellReason = '';

      if (profile.hasBusiness && !existingProducts.has('EMPRESARIAL_DOP') && policy.products?.EMPRESARIAL_DOP) {
        suggestedNewProduct = 'EMPRESARIAL_DOP';
        crossSellReason =
          'El cliente posee perfil o actividad comercial registrada pero aún no ha utilizado la línea Empresarial DOP vigente.';
      } else if (
        profile.incomeCurrency === 'USD' &&
        !existingProducts.has('PERSONAL_USD') &&
        policy.products?.PERSONAL_USD
      ) {
        suggestedNewProduct = 'PERSONAL_USD';
        crossSellReason =
          'El cliente declara ingresos en USD, permitiendo diversificar con producto Personal USD sin descalce cambiario.';
      } else if (
        profile.hasBusiness &&
        profile.incomeCurrency === 'USD' &&
        !existingProducts.has('EMPRESARIAL_USD') &&
        policy.products?.EMPRESARIAL_USD
      ) {
        suggestedNewProduct = 'EMPRESARIAL_USD';
        crossSellReason =
          'Actividad empresarial con generación en divisas compatible con línea Empresarial USD configurada en AxyCore.';
      } else if (
        !existingProducts.has('PERSONAL_DOP') &&
        existingProducts.has('EMPRESARIAL_DOP') &&
        policy.products?.PERSONAL_DOP
      ) {
        suggestedNewProduct = 'PERSONAL_DOP';
        crossSellReason =
          'Cliente empresarial con historial sano elegible para producto complementario Personal DOP.';
      }

      if (suggestedNewProduct) {
        const refLoan = profile.activeLoans[0] || profile.closedLoans[0];
        const newProdCfg =
          policy.products?.[suggestedNewProduct] || DEFAULT_POLICY_V2.products[suggestedNewProduct];
        const baseTarget =
          newProdCfg.currency === refLoan.currency
            ? Math.max(newProdCfg.minAmount, refLoan.approvedPrincipal)
            : newProdCfg.minAmount * 2;
        const offer = validateAndBoundOffer({
          policy,
          productCode: suggestedNewProduct,
          rawAmount: baseTarget,
          rawTermMonths: Math.min(newProdCfg.maxTermMonths, 12),
          profile,
        });

        if (offer.policyCompliant) {
          const score = clamp(Math.round(54 + (profile.hasBusiness ? 16 : 8) + (profile.maxHistoricalDpd === 0 ? 10 : 0)), 38, 88);
          upsertCandidate(
            {
              organizationId: orgId,
              sourceKey: buildSourceKey(orgId, customer.id, 'NUEVO_PRODUCTO', suggestedNewProduct),
              customerId: customer.id,
              customerName: profile.customerName,
              customerDocument: customer.documentNumber,
              customerPhone: customer.phone,
              customerEmail: customer.email,
              branchOrProvince: profile.branchOrProvince,
              category: 'NUEVO_PRODUCTO',
              priority: computePriority(score),
              priorityScore: score,
              commercialConversionProbability: 48,
              confidenceScore: 82,
              sourceLoanId: refLoan.id,
              sourceLoanNumber: refLoan.loanNumber,
              sourceProductCode: refLoan.productCode,
              currency: newProdCfg.currency,
              currentLoanBalance: round2(refLoan.currentPrincipalBalance),
              previousPrincipalAmount: round2(refLoan.approvedPrincipal),
              paidPrincipalAmount: round2(refLoan.paidPrincipalTotal || 0),
              remainingInstallments: (installmentsByLoan.get(refLoan.id) || []).filter(
                (i) => i.status !== 'PAGADA'
              ).length,
              totalInstallments: (installmentsByLoan.get(refLoan.id) || []).length,
              estimatedMaturityDate: refLoan.maturityDate,
              currentDpd: profile.currentMaxDpd,
              maxHistoricalDpd: profile.maxHistoricalDpd,
              earlyPaymentsCount: profile.earlyPaymentsCount,
              completedLoansCount: profile.closedLoans.length,
              daysSinceLastClosedLoan: null,
              latestBehaviorScore: profile.averageBehaviorScore,
              latestOriginationScore: profile.latestOriginationScore,
              recommendedProductCode: suggestedNewProduct,
              recommendedProductLabel: newProdCfg.label,
              suggestedAmount: offer.amount,
              suggestedTermMonths: offer.termMonths,
              suggestedFrequency: newProdCfg.allowedFrequencies[0] || 'MENSUAL',
              estimatedMonthlyRatePct: offer.ratePct,
              estimatedInstallment: offer.installment,
              estimatedNetProfit: offer.netProfit,
              estimatedPaymentCapacity: profile.availableMonthlyFlow,
              estimatedCurrentDtiPct: profile.currentDtiPct,
              estimatedProjectedDtiPct: offer.projectedDtiPct,
              policyCompliant: offer.policyCompliant,
              policyNotes: offer.policyNotes,
              summaryReason: crossSellReason,
              detailedReasons: [
                crossSellReason,
                `Producto sugerido (${newProdCfg.label}) activo en la política crediticia vigente de la institución.`,
                `Atraso máximo histórico de ${profile.maxHistoricalDpd} días respalda elegibilidad comercial para venta cruzada.`,
              ],
              evidenceMetrics: [
                { label: 'Producto actual', value: refLoan.productCode, source: refLoan.loanNumber },
                { label: 'Producto sugerido', value: newProdCfg.label, source: 'Catálogo de Política Vigente' },
                { label: 'Moneda ingresos', value: profile.incomeCurrency, source: 'Expediente cliente' },
              ],
              risksIdentified: baseRisks,
              centinelaAlertsCount: profile.openCentinelaAlerts.length,
              nextRecommendedAction:
                `Presentar beneficios de ${newProdCfg.label} y confirmar requisitos documentales antes de generar solicitud.`,
              creditApprovalDisclaimer: COMMERCIAL_DISCLAIMER,
              lastEvaluatedAtIso: nowIso,
            },
            profile
          );
        }
      }
    }
  }

  const allOpportunities = Array.from(existingBySourceKey.values()).sort(
    (a, b) => b.priorityScore - a.priorityScore
  );

  return {
    opportunities: allOpportunities,
    created,
    updated,
    reconciled,
    autoAssignedCount,
    skippedByRiskCount,
    customersAnalyzed: input.customers.length,
    loansAnalyzed: input.loans.length,
  };
}

export function computeImpulsaInternalAlerts(
  opportunities: ImpulsaOpportunityRecord[],
  config: ImpulsaEngineConfig,
  nowIso: string = new Date().toISOString()
): ImpulsaInternalAlert[] {
  const alerts: ImpulsaInternalAlert[] = [];
  const nowMs = new Date(nowIso).getTime();
  const todayStr = nowIso.slice(0, 10);
  const slaMs = Math.max(1, config.unmanagedAlertHours || 48) * 3_600_000;

  for (const opp of opportunities) {
    if (TERMINAL_IMPULSA_STATUSES.has(opp.status)) continue;

    // 1. Follow-up due today or overdue
    if (opp.nextFollowUpDate && opp.nextFollowUpDate <= todayStr) {
      alerts.push({
        id: `al_fu_${opp.id}`,
        opportunityId: opp.id,
        opportunityCode: opp.opportunityCode,
        customerName: opp.customerName,
        severity: opp.nextFollowUpDate < todayStr ? 'CRITICA' : 'ALTA',
        type: 'SEGUIMIENTO_HOY_O_VENCIDO',
        title:
          opp.nextFollowUpDate < todayStr
            ? `Seguimiento vencido (${opp.nextFollowUpDate})`
            : 'Seguimiento programado para hoy',
        detail: `${opp.customerName} · ${IMPULSA_CATEGORY_LABELS[opp.category]} (${IMPULSA_STATUS_LABELS[opp.status]}).`,
        assignedOfficerName: opp.assignedOfficerName,
        dueDate: opp.nextFollowUpDate,
      });
    }

    // 2. Unmanaged beyond SLA hours
    const detectedMs = new Date(opp.detectedAtIso).getTime();
    if (
      (opp.status === 'DETECTADA' ||
        opp.status === 'PENDIENTE_ASIGNACION' ||
        opp.status === 'ASIGNADA' ||
        opp.status === 'PENDIENTE_CONTACTO') &&
      Number.isFinite(detectedMs) &&
      nowMs - detectedMs >= slaMs &&
      !opp.lastContactAtIso
    ) {
      const hoursElapsed = Math.floor((nowMs - detectedMs) / 3_600_000);
      alerts.push({
        id: `al_sla_${opp.id}`,
        opportunityId: opp.id,
        opportunityCode: opp.opportunityCode,
        customerName: opp.customerName,
        severity: opp.priority === 'CRITICA' ? 'CRITICA' : 'ALTA',
        type: 'SIN_GESTIONAR_SLA',
        title: `Sin gestionar hace ${hoursElapsed}h (SLA ${config.unmanagedAlertHours}h)`,
        detail: `${opp.customerName} espera primer contacto comercial (${IMPULSA_CATEGORY_LABELS[opp.category]}).`,
        assignedOfficerName: opp.assignedOfficerName,
      });
    }

    // 3. Window expiring within 5 days
    if (opp.windowExpiresAtIso) {
      const daysLeft = daysBetween(todayStr, opp.windowExpiresAtIso.slice(0, 10));
      if (daysLeft >= 0 && daysLeft <= 5 && opp.status !== 'CONVERTIDA_SOLICITUD' && opp.status !== 'EN_EVALUACION' && opp.status !== 'APROBADA') {
        alerts.push({
          id: `al_exp_${opp.id}`,
          opportunityId: opp.id,
          opportunityCode: opp.opportunityCode,
          customerName: opp.customerName,
          severity: daysLeft <= 2 ? 'CRITICA' : 'MEDIA',
          type: 'VENTANA_POR_VENCER',
          title: `Ventana comercial vence en ${daysLeft} día(s)`,
          detail: `Oportunidad ${opp.opportunityCode} de ${opp.customerName} próxima a expirar.`,
          assignedOfficerName: opp.assignedOfficerName,
          dueDate: opp.windowExpiresAtIso.slice(0, 10),
        });
      }
    }

    // 4. New critical/high opportunity detected in last 24h
    if (
      (opp.status === 'DETECTADA' || opp.status === 'ASIGNADA' || opp.status === 'PENDIENTE_ASIGNACION') &&
      Number.isFinite(detectedMs) &&
      nowMs - detectedMs < 86_400_000 &&
      (opp.priority === 'CRITICA' || opp.priority === 'ALTA')
    ) {
      alerts.push({
        id: `al_new_${opp.id}`,
        opportunityId: opp.id,
        opportunityCode: opp.opportunityCode,
        customerName: opp.customerName,
        severity: opp.priority === 'CRITICA' ? 'ALTA' : 'MEDIA',
        type: 'NUEVA_OPORTUNIDAD',
        title: `Nueva oportunidad ${opp.priority.toLowerCase()} detectada`,
        detail: `${opp.customerName} · ${IMPULSA_CATEGORY_LABELS[opp.category]} por ${formatMoney(opp.suggestedAmount, opp.currency)}.`,
        assignedOfficerName: opp.assignedOfficerName,
      });
    }

    // 5. Centinela signal active on open opportunity
    if (opp.centinelaAlertsCount > 0) {
      alerts.push({
        id: `al_cen_${opp.id}`,
        opportunityId: opp.id,
        opportunityCode: opp.opportunityCode,
        customerName: opp.customerName,
        severity: 'ALTA',
        type: 'ALERTA_CENTINELA_ACTIVA',
        title: `${opp.centinelaAlertsCount} alerta(s) Centinela vinculada(s)`,
        detail: `Revisar señales de riesgo antes de avanzar oferta con ${opp.customerName}.`,
        assignedOfficerName: opp.assignedOfficerName,
      });
    }
  }

  const weight: Record<ImpulsaInternalAlert['severity'], number> = {
    CRITICA: 3,
    ALTA: 2,
    MEDIA: 1,
  };
  return alerts.sort((a, b) => weight[b.severity] - weight[a.severity]);
}

export function computeImpulsaCommercialMetrics(params: {
  opportunities: ImpulsaOpportunityRecord[];
  loans: LoanRecord[];
  applications: ApplicationRecord[];
  dopPerUsd?: number;
  nowIso?: string;
}): {
  metrics: ImpulsaCommercialMetrics;
  charts: ImpulsaChartDatasets;
} {
  const { opportunities, loans, dopPerUsd = 60, nowIso = new Date().toISOString() } = params;
  const todayStr = nowIso.slice(0, 10);

  let newOpportunities = 0;
  let pendingManagement = 0;
  let contactedOpportunities = 0;
  let interestedClients = 0;
  let applicationsGenerated = 0;
  let applicationsInEvaluation = 0;
  let approvedCredits = 0;
  let disbursedCredits = 0;
  let discardedOrNotInterested = 0;
  let potentialPlacementAmountDop = 0;
  let disbursedAmountDop = 0;
  let estimatedProfitabilityDop = 0;
  let activeCriticalCount = 0;
  let activeHighCount = 0;
  let unassignedCount = 0;
  let overdueFollowUpsCount = 0;

  const monthMap = new Map<
    string,
    { detectadas: number; solicitudes: number; desembolsadas: number; montoPotencial: number; montoDesembolsado: number }
  >();
  const productMap = new Map<
    string,
    { productCode: string; productLabel: string; count: number; potentialAmount: number; disbursedAmount: number }
  >();
  const branchMap = new Map<
    string,
    { branch: string; count: number; potentialAmount: number; disbursedAmount: number }
  >();
  const officerMap = new Map<
    string,
    {
      officerId: string;
      officerName: string;
      assigned: number;
      contacted: number;
      converted: number;
      disbursed: number;
      potentialAmount: number;
      disbursedAmount: number;
    }
  >();
  const categoryMap = new Map<
    ImpulsaOpportunityCategory,
    { category: ImpulsaOpportunityCategory; label: string; count: number; potentialAmount: number }
  >();

  for (const opp of opportunities) {
    const amountDop = toDop(opp.suggestedAmount, opp.currency, dopPerUsd);
    const profitDop = toDop(opp.estimatedNetProfit, opp.currency, dopPerUsd);
    const disbDop =
      opp.status === 'DESEMBOLSADA'
        ? toDop(opp.disbursedAmount ?? opp.suggestedAmount, opp.currency, dopPerUsd)
        : 0;

    if (opp.status === 'DETECTADA') newOpportunities += 1;
    if (
      opp.status === 'DETECTADA' ||
      opp.status === 'PENDIENTE_ASIGNACION' ||
      opp.status === 'ASIGNADA' ||
      opp.status === 'PENDIENTE_CONTACTO' ||
      opp.status === 'REPROGRAMADA'
    ) {
      pendingManagement += 1;
    }
    if (
      opp.status === 'CONTACTADA' ||
      opp.status === 'CLIENTE_INTERESADO' ||
      opp.status === 'PENDIENTE_DOCUMENTACION' ||
      opp.status === 'CONVERTIDA_SOLICITUD' ||
      opp.status === 'EN_EVALUACION' ||
      opp.status === 'APROBADA' ||
      opp.status === 'DESEMBOLSADA'
    ) {
      contactedOpportunities += 1;
    }
    if (
      opp.status === 'CLIENTE_INTERESADO' ||
      opp.status === 'PENDIENTE_DOCUMENTACION'
    ) {
      interestedClients += 1;
    }
    if (
      opp.linkedApplicationId ||
      opp.status === 'CONVERTIDA_SOLICITUD' ||
      opp.status === 'EN_EVALUACION' ||
      opp.status === 'APROBADA' ||
      opp.status === 'DESEMBOLSADA'
    ) {
      applicationsGenerated += 1;
    }
    if (opp.status === 'EN_EVALUACION') applicationsInEvaluation += 1;
    if (opp.status === 'APROBADA') approvedCredits += 1;
    if (opp.status === 'DESEMBOLSADA') disbursedCredits += 1;
    if (opp.status === 'DESCARTADA' || opp.status === 'NO_INTERESADO') {
      discardedOrNotInterested += 1;
    }

    if (!TERMINAL_IMPULSA_STATUSES.has(opp.status) || opp.status === 'DESEMBOLSADA') {
      potentialPlacementAmountDop += amountDop;
      estimatedProfitabilityDop += profitDop;
    }
    disbursedAmountDop += disbDop;

    if (!TERMINAL_IMPULSA_STATUSES.has(opp.status)) {
      if (opp.priority === 'CRITICA') activeCriticalCount += 1;
      if (opp.priority === 'ALTA') activeHighCount += 1;
      if (!opp.assignedOfficerId) unassignedCount += 1;
      if (opp.nextFollowUpDate && opp.nextFollowUpDate <= todayStr) {
        overdueFollowUpsCount += 1;
      }
    }

    // Monthly evolution
    const ym = (opp.detectedAtIso || nowIso).slice(0, 7);
    const mEntry = monthMap.get(ym) || {
      detectadas: 0,
      solicitudes: 0,
      desembolsadas: 0,
      montoPotencial: 0,
      montoDesembolsado: 0,
    };
    mEntry.detectadas += 1;
    mEntry.montoPotencial = round2(mEntry.montoPotencial + amountDop);
    if (
      opp.linkedApplicationId ||
      opp.status === 'CONVERTIDA_SOLICITUD' ||
      opp.status === 'EN_EVALUACION' ||
      opp.status === 'APROBADA' ||
      opp.status === 'DESEMBOLSADA'
    ) {
      mEntry.solicitudes += 1;
    }
    if (opp.status === 'DESEMBOLSADA') {
      mEntry.desembolsadas += 1;
      mEntry.montoDesembolsado = round2(mEntry.montoDesembolsado + disbDop);
    }
    monthMap.set(ym, mEntry);

    // By Product
    const pEntry = productMap.get(opp.recommendedProductCode) || {
      productCode: opp.recommendedProductCode,
      productLabel: opp.recommendedProductLabel,
      count: 0,
      potentialAmount: 0,
      disbursedAmount: 0,
    };
    pEntry.count += 1;
    pEntry.potentialAmount = round2(pEntry.potentialAmount + amountDop);
    pEntry.disbursedAmount = round2(pEntry.disbursedAmount + disbDop);
    productMap.set(opp.recommendedProductCode, pEntry);

    // By Branch / Province
    const branchKey = opp.branchOrProvince || 'Sede Principal';
    const bEntry = branchMap.get(branchKey) || {
      branch: branchKey,
      count: 0,
      potentialAmount: 0,
      disbursedAmount: 0,
    };
    bEntry.count += 1;
    bEntry.potentialAmount = round2(bEntry.potentialAmount + amountDop);
    bEntry.disbursedAmount = round2(bEntry.disbursedAmount + disbDop);
    branchMap.set(branchKey, bEntry);

    // By Officer
    const offId = opp.assignedOfficerId || 'UNASSIGNED';
    const offName = opp.assignedOfficerName || 'Sin asignar';
    const oEntry = officerMap.get(offId) || {
      officerId: offId,
      officerName: offName,
      assigned: 0,
      contacted: 0,
      converted: 0,
      disbursed: 0,
      potentialAmount: 0,
      disbursedAmount: 0,
    };
    oEntry.assigned += 1;
    if (opp.lastContactAtIso || opp.status === 'CONTACTADA' || opp.status === 'CLIENTE_INTERESADO') {
      oEntry.contacted += 1;
    }
    if (opp.linkedApplicationId || opp.status === 'CONVERTIDA_SOLICITUD' || opp.status === 'EN_EVALUACION' || opp.status === 'APROBADA' || opp.status === 'DESEMBOLSADA') {
      oEntry.converted += 1;
    }
    if (opp.status === 'DESEMBOLSADA') {
      oEntry.disbursed += 1;
      oEntry.disbursedAmount = round2(oEntry.disbursedAmount + disbDop);
    }
    oEntry.potentialAmount = round2(oEntry.potentialAmount + amountDop);
    officerMap.set(offId, oEntry);

    // By Category
    const cEntry = categoryMap.get(opp.category) || {
      category: opp.category,
      label: IMPULSA_CATEGORY_LABELS[opp.category],
      count: 0,
      potentialAmount: 0,
    };
    cEntry.count += 1;
    cEntry.potentialAmount = round2(cEntry.potentialAmount + amountDop);
    categoryMap.set(opp.category, cEntry);
  }

  const totalOpportunities = opportunities.length;
  const conversionRatePct =
    totalOpportunities > 0 ? round2((disbursedCredits / totalOpportunities) * 100) : 0;
  const applicationConversionRatePct =
    totalOpportunities > 0 ? round2((applicationsGenerated / totalOpportunities) * 100) : 0;
  const averageTicketDop =
    totalOpportunities > 0 ? round2(potentialPlacementAmountDop / totalOpportunities) : 0;

  // Real renewals vs first-time borrowers across portfolio loans
  const loansPerCustomer = new Map<string, LoanRecord[]>();
  let totalPortfolioAmountDop = 0;
  for (const loan of loans) {
    totalPortfolioAmountDop += toDop(loan.approvedPrincipal, loan.currency, dopPerUsd);
    const arr = loansPerCustomer.get(loan.customerId) || [];
    arr.push(loan);
    loansPerCustomer.set(loan.customerId, arr);
  }
  let renewalLoansCount = 0;
  let renewalLoansAmount = 0;
  let newClientLoansCount = 0;
  let newClientLoansAmount = 0;
  for (const custLoans of loansPerCustomer.values()) {
    const sorted = [...custLoans].sort((a, b) =>
      String(a.disbursementDate || '').localeCompare(String(b.disbursementDate || ''))
    );
    sorted.forEach((l, idx) => {
      const amt = toDop(l.approvedPrincipal, l.currency, dopPerUsd);
      if (idx === 0) {
        newClientLoansCount += 1;
        newClientLoansAmount = round2(newClientLoansAmount + amt);
      } else {
        renewalLoansCount += 1;
        renewalLoansAmount = round2(renewalLoansAmount + amt);
      }
    });
  }

  const evolutionByMonth = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  const conversionByPeriod = evolutionByMonth.map((m) => ({
    period: m.month,
    total: m.detectadas,
    convertidas: m.solicitudes,
    desembolsadas: m.desembolsadas,
    tasaConversionPct: m.detectadas > 0 ? round2((m.desembolsadas / m.detectadas) * 100) : 0,
  }));

  const byOfficer = Array.from(officerMap.values())
    .map((o) => ({
      ...o,
      conversionRatePct: o.assigned > 0 ? round2((o.disbursed / o.assigned) * 100) : 0,
    }))
    .sort((a, b) => b.potentialAmount - a.potentialAmount);

  return {
    metrics: {
      totalOpportunities,
      newOpportunities,
      pendingManagement,
      contactedOpportunities,
      interestedClients,
      applicationsGenerated,
      applicationsInEvaluation,
      approvedCredits,
      disbursedCredits,
      discardedOrNotInterested,
      potentialPlacementAmountDop: round2(potentialPlacementAmountDop),
      disbursedAmountDop: round2(disbursedAmountDop),
      conversionRatePct,
      applicationConversionRatePct,
      estimatedProfitabilityDop: round2(estimatedProfitabilityDop),
      averageTicketDop,
      activeCriticalCount,
      activeHighCount,
      unassignedCount,
      overdueFollowUpsCount,
    },
    charts: {
      evolutionByMonth,
      conversionByPeriod,
      byProduct: Array.from(productMap.values()).sort((a, b) => b.potentialAmount - a.potentialAmount),
      byBranch: Array.from(branchMap.values()).sort((a, b) => b.potentialAmount - a.potentialAmount),
      byOfficer,
      byCategory: Array.from(categoryMap.values()).sort((a, b) => b.count - a.count),
      renewalsVsNewClients: [
        { segment: 'Renovaciones / Recurrentes', count: renewalLoansCount, amount: renewalLoansAmount },
        { segment: 'Primer Crédito (Clientes Nuevos)', count: newClientLoansCount, amount: newClientLoansAmount },
      ],
      impulsaPlacementsShare: {
        totalPortfolioLoansCount: loans.length,
        impulsaGeneratedLoansCount: disbursedCredits,
        totalPortfolioAmountDop: round2(totalPortfolioAmountDop),
        impulsaGeneratedAmountDop: round2(disbursedAmountDop),
        shareByAmountPct:
          totalPortfolioAmountDop > 0
            ? round2((disbursedAmountDop / totalPortfolioAmountDop) * 100)
            : 0,
      },
    },
  };
}

/**
 * Deterministic natural-language query engine grounded 100% on real AxyCore/Impulsa data.
 * Serves both as instant local analyzer and fallback when server-side Gemini is unavailable.
 */
export function runDeterministicImpulsaQuery(params: {
  question: string;
  opportunities: ImpulsaOpportunityRecord[];
  metrics: ImpulsaCommercialMetrics;
  charts: ImpulsaChartDatasets;
  alerts: ImpulsaInternalAlert[];
}): Omit<ImpulsaAssistantMessage, 'id' | 'role' | 'timestampIso'> {
  const q = (params.question || '').toLowerCase();
  const activeOpps = params.opportunities.filter((o) => !TERMINAL_IMPULSA_STATUSES.has(o.status));
  const cited: NonNullable<ImpulsaAssistantMessage['citedOpportunities']> = [];

  const pushCited = (list: ImpulsaOpportunityRecord[], max = 6) => {
    for (const o of list.slice(0, max)) {
      cited.push({
        id: o.id,
        code: o.opportunityCode,
        customerName: o.customerName,
        category: IMPULSA_CATEGORY_LABELS[o.category],
        suggestedAmount: o.suggestedAmount,
        currency: o.currency,
      });
    }
  };

  if (params.opportunities.length === 0) {
    return {
      content:
        'Actualmente no hay oportunidades registradas en Impulsa para esta institución. Ejecuta el Detector Inteligente de Oportunidades para analizar la cartera real de clientes, préstamos, cuotas y pagos.',
      keyFindings: ['0 oportunidades persistidas en la organización actual.'],
      recommendedActions: [
        'Ejecutar el análisis del Detector Inteligente desde la cabecera de Impulsa.',
        'Verificar que existan clientes y préstamos cargados en AxyCore.',
      ],
      citedOpportunities: [],
      missingData: ['No existen oportunidades detectadas todavía en el periodo consultado.'],
      modelUsed: 'Impulsa Deterministic Engine v1',
      isDeterministicFallback: true,
    };
  }

  // Renewal queries
  if (q.includes('renovar') || q.includes('renovaci') || q.includes('terminar') || q.includes('próxim')) {
    const renewals = activeOpps
      .filter((o) => o.category === 'RENOVACION_ANTICIPADA')
      .sort((a, b) => b.priorityScore - a.priorityScore);
    pushCited(renewals);
    const totalAmt = renewals.reduce((s, o) => s + o.suggestedAmount, 0);
    return {
      content:
        renewals.length > 0
          ? `Se identificaron ${renewals.length} cliente(s) con oportunidad activa de Renovación Anticipada por un potencial agregado de RD$${round2(totalAmt).toLocaleString('en-US')}. Los casos más prioritarios tienen ≤3 cuotas pendientes o ≥65% de capital amortizado sin atrasos relevantes.`
          : 'No se registran oportunidades activas de Renovación Anticipada en este momento según los umbrales vigentes.',
      keyFindings: renewals.slice(0, 5).map(
        (o) =>
          `${o.customerName} (${o.opportunityCode}): ${o.remainingInstallments} cuota(s) restante(s), monto sugerido ${formatMoney(o.suggestedAmount, o.currency)}, prioridad ${o.priority}.`
      ),
      recommendedActions: [
        'Priorizar contacto con clientes de prioridad Crítica/Alta antes del vencimiento de su última cuota.',
        'Convertir los interesados directamente en solicitud para evaluación por Motor V2.',
      ],
      citedOpportunities: cited,
      missingData: renewals.length === 0 ? ['Ningún préstamo activo cumple actualmente los criterios de renovación anticipada.'] : [],
      modelUsed: 'Impulsa Deterministic Engine v1',
      isDeterministicFallback: true,
    };
  }

  // Growth / higher financing queries
  if (q.includes('crecimiento') || q.includes('mayor') || q.includes('superior') || q.includes('incremento')) {
    const growth = activeOpps
      .filter((o) => o.category === 'CRECIMIENTO_CREDITICIO')
      .sort((a, b) => b.suggestedAmount - a.suggestedAmount);
    pushCited(growth);
    return {
      content:
        growth.length > 0
          ? `Existen ${growth.length} cliente(s) con capacidad de pago verificada para acceder a un financiamiento superior respetando el DTI y límites de política vigentes.`
          : 'No hay clientes con oportunidad activa de Crecimiento Crediticio validada por capacidad en este momento.',
      keyFindings: growth.slice(0, 5).map(
        (o) =>
          `${o.customerName} (${o.opportunityCode}): de ${formatMoney(o.previousPrincipalAmount, o.currency)} → ${formatMoney(o.suggestedAmount, o.currency)} (DTI proyectado ${o.estimatedProjectedDtiPct ?? 'N/D'}%).`
      ),
      recommendedActions: [
        'Validar comprobantes recientes de ingresos antes de originar la solicitud de ampliación.',
      ],
      citedOpportunities: cited,
      missingData: growth.length === 0 ? ['Se requiere historial de pagos puntual e ingresos declarados con margen de DTI.'] : [],
      modelUsed: 'Impulsa Deterministic Engine v1',
      isDeterministicFallback: true,
    };
  }

  // Unmanaged / missed opportunities queries
  if (q.includes('sin gestionar') || q.includes('pendiente') || q.includes('dejando pasar') || q.includes('atenci')) {
    const unmanaged = activeOpps
      .filter((o) => !o.lastContactAtIso && ['DETECTADA', 'PENDIENTE_ASIGNACION', 'ASIGNADA', 'PENDIENTE_CONTACTO'].includes(o.status))
      .sort((a, b) => b.priorityScore - a.priorityScore);
    pushCited(unmanaged);
    return {
      content: `Hay ${unmanaged.length} oportunidad(es) comercial(es) aún sin primer contacto registrado (${params.metrics.unassignedCount} sin oficial asignado y ${params.alerts.length} alerta(s) interna(s) activa(s)).`,
      keyFindings: [
        `Potencial aún pendiente de gestión: RD$${round2(unmanaged.reduce((s, o) => s + o.suggestedAmount, 0)).toLocaleString('en-US')}.`,
        ...unmanaged.slice(0, 4).map(
          (o) => `${o.customerName} (${o.opportunityCode}) · ${IMPULSA_CATEGORY_LABELS[o.category]} · Prioridad ${o.priority} · Oficial: ${o.assignedOfficerName || 'Sin asignar'}.`
        ),
      ],
      recommendedActions: [
        'Asignar de inmediato las oportunidades sin responsable desde la Bandeja de Gestión.',
        'Atender primero las alertas de SLA vencido y ventanas próximas a expirar.',
      ],
      citedOpportunities: cited,
      missingData: [],
      modelUsed: 'Impulsa Deterministic Engine v1',
      isDeterministicFallback: true,
    };
  }

  // Officer conversion / performance queries
  if (q.includes('oficial') || q.includes('conversi') || q.includes('rendimiento') || q.includes('equipo')) {
    const topOfficers = [...params.charts.byOfficer].sort(
      (a, b) => b.conversionRatePct - a.conversionRatePct || b.disbursedAmount - a.disbursedAmount
    );
    return {
      content: `La tasa de conversión comercial global de Impulsa es ${params.metrics.conversionRatePct}% (${params.metrics.disbursedCredits} desembolsados de ${params.metrics.totalOpportunities} oportunidades; ${params.metrics.applicationsGenerated} convertidas en solicitud).`,
      keyFindings: topOfficers.slice(0, 5).map(
        (o) =>
          `${o.officerName}: ${o.assigned} asignadas, ${o.contacted} contactadas, ${o.converted} solicitudes, ${o.disbursed} desembolsos (${o.conversionRatePct}% conversión).`
      ),
      recommendedActions: [
        'Rebalancear carga comercial hacia oficiales con menor volumen pendiente.',
        'Dar seguimiento semanal a las solicitudes en evaluación para acelerar cierre.',
      ],
      citedOpportunities: [],
      missingData: topOfficers.length === 0 ? ['No existen oficiales con oportunidades asignadas aún.'] : [],
      modelUsed: 'Impulsa Deterministic Engine v1',
      isDeterministicFallback: true,
    };
  }

  // Inactive / recovery queries
  if (q.includes('inactiv') || q.includes('antiguo') || q.includes('recuper')) {
    const inactive = activeOpps
      .filter((o) => o.category === 'CLIENTE_INACTIVO')
      .sort((a, b) => b.priorityScore - a.priorityScore);
    pushCited(inactive);
    return {
      content: `Se detectaron ${inactive.length} cliente(s) antiguo(s) inactivo(s) con buen historial crediticio que ya liquidaron sus créditos anteriores.`,
      keyFindings: inactive.slice(0, 5).map(
        (o) =>
          `${o.customerName} (${o.opportunityCode}): ${o.daysSinceLastClosedLoan ?? 0} días sin crédito activo, ${o.completedLoansCount} préstamo(s) cerrado(s), sugerido ${formatMoney(o.suggestedAmount, o.currency)}.`
      ),
      recommendedActions: [
        'Activar campaña de llamada de reactivación con condiciones transparentes sujetas a validación.',
      ],
      citedOpportunities: cited,
      missingData: [],
      modelUsed: 'Impulsa Deterministic Engine v1',
      isDeterministicFallback: true,
    };
  }

  // Default executive commercial summary
  const topActive = [...activeOpps].sort((a, b) => b.priorityScore - a.priorityScore);
  pushCited(topActive);
  return {
    content: `Resumen comercial real de Impulsa: ${params.metrics.totalOpportunities} oportunidades identificadas (${params.metrics.activeCriticalCount} críticas, ${params.metrics.activeHighCount} altas), monto potencial de colocación RD$${params.metrics.potentialPlacementAmountDop.toLocaleString('en-US')}, ${params.metrics.applicationsGenerated} solicitudes generadas y ${params.metrics.disbursedCredits} desembolsos efectivos (RD$${params.metrics.disbursedAmountDop.toLocaleString('en-US')}, conversión ${params.metrics.conversionRatePct}%).`,
    keyFindings: [
      `Rentabilidad bruta estimada del pipeline activo: RD$${params.metrics.estimatedProfitabilityDop.toLocaleString('en-US')}.`,
      `Pendientes de gestión comercial: ${params.metrics.pendingManagement} · Interesados: ${params.metrics.interestedClients} · En evaluación: ${params.metrics.applicationsInEvaluation}.`,
      ...topActive.slice(0, 3).map(
        (o) => `Top prioridad: ${o.customerName} (${IMPULSA_CATEGORY_LABELS[o.category]}, ${formatMoney(o.suggestedAmount, o.currency)}, Prob. comercial ${o.commercialConversionProbability}%).`
      ),
    ],
    recommendedActions: [
      'Gestionar inmediatamente las oportunidades de prioridad Crítica y Alta sin contacto.',
      'Convertir los expedientes con cliente interesado en solicitud formal para evaluación en Motor V2.',
    ],
    citedOpportunities: cited,
    missingData: [],
    modelUsed: 'Impulsa Deterministic Engine v1',
    isDeterministicFallback: true,
  };
}

export type LifecycleMacroStage =
  | 'DETECTADA'
  | 'ASIGNADA'
  | 'CONTACTADA'
  | 'CONVERTIDA'
  | 'CERRADA';

export function getLifecycleMacroStage(status: ImpulsaOpportunityStatus): LifecycleMacroStage {
  switch (status) {
    case 'DETECTADA':
    case 'PENDIENTE_ASIGNACION':
      return 'DETECTADA';
    case 'ASIGNADA':
    case 'PENDIENTE_CONTACTO':
    case 'REPROGRAMADA':
      return 'ASIGNADA';
    case 'CONTACTADA':
    case 'CLIENTE_INTERESADO':
    case 'PENDIENTE_DOCUMENTACION':
      return 'CONTACTADA';
    case 'CONVERTIDA_SOLICITUD':
    case 'EN_EVALUACION':
    case 'APROBADA':
    case 'DESEMBOLSADA':
      return 'CONVERTIDA';
    case 'NO_INTERESADO':
    case 'DESCARTADA':
    default:
      return 'CERRADA';
  }
}

