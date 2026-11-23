import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import {
  ACTIVE_IN_FLIGHT_RENEWAL_STATUSES,
  calculateRenewalNetDisbursement,
  computeRenewalPayoffBreakdown,
  evaluateLoanRenewalEligibility,
} from '../engine/renewalEngine';
import {
  buildOriginalRequestedConditions,
  canUserOverrideRateOrFees,
  computeInstallmentCountFromMonths,
  runIntegratedDecisionAndCalculation,
} from '../engine/integratedCreditEngine';
import { DEFAULT_POLICY_V2 } from '../engine/decisionEngineV2';
import { buildCriticalAuditEntryPayload } from '../engine/criticalAudit';
import {
  appendMovementHistory,
  generateId,
  sanitizeFirestorePayload,
} from './axycoreStore';
import {
  formatMoney,
  normalizeMonthlyRateDecimal,
  sanitizeIdSegment,
  toIsoDateOnly,
} from '../utils/formatters';
import type {
  AmortizationMethod,
  ApplicationRecord,
  BusinessRecord,
  CollectionAccountRecord,
  CollectionPolicyVersionRecord,
  CreditPolicyRecord,
  CreditRenewalRecord,
  CustomerRecord,
  LegalFeeApplicationMode,
  LoanInstallmentRecord,
  LoanRecord,
  PaymentFrequency,
  PaymentRecord,
  ProductCode,
  RenewalModality,
  UserProfile,
} from '../types/axycore';

export interface InitiateLoanRenewalParams {
  originLoan: LoanRecord;
  customer: CustomerRecord;
  business?: BusinessRecord | null;
  originApplication?: ApplicationRecord | null;
  originInstallments: LoanInstallmentRecord[];
  originPayments: PaymentRecord[];
  originCollectionAccount?: CollectionAccountRecord | null;
  existingRenewals: CreditRenewalRecord[];
  policy: CreditPolicyRecord;
  collectionPolicy?: CollectionPolicyVersionRecord;
  modality: RenewalModality;
  requestedAmount?: number;
  requestedTermMonths?: number;
  requestedRateMonthly?: number;
  paymentFrequency?: PaymentFrequency;
  amortizationMethod?: AmortizationMethod;
  productCode?: ProductCode;
  legalFeeMode?: LegalFeeApplicationMode;
  proposedCollateral?: string;
  coDebtors?: Array<{ fullName: string; phone?: string; relationship?: string }>;
  justification?: string;
  asOfDateIso?: string;
  user: UserProfile;
}

export interface InitiateLoanRenewalResult {
  renewal: CreditRenewalRecord;
  application: ApplicationRecord;
}

export async function initiateLoanRenewal(
  params: InitiateLoanRenewalParams
): Promise<InitiateLoanRenewalResult> {
  const {
    originLoan,
    customer,
    originApplication,
    originInstallments,
    originPayments,
    originCollectionAccount,
    existingRenewals,
    policy,
    collectionPolicy,
    modality,
    user,
  } = params;

  const organizationId = originLoan.organizationId || customer.organizationId || user.organizationId;
  const asOfDateIso = params.asOfDateIso || toIsoDateOnly();

  // Live concurrency check against Firestore so two staff members cannot open duplicate renewals simultaneously
  let liveRenewalsForLoan: CreditRenewalRecord[] = existingRenewals.filter(
    (r) => r.originLoanId === originLoan.id
  );
  try {
    const snap = await getDocs(
      query(
        collection(db, 'credit_renewals'),
        where('organizationId', '==', organizationId),
        where('originLoanId', '==', originLoan.id)
      )
    );
    const firestoreRenewals = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<CreditRenewalRecord, 'id'>),
    }));
    const byId = new Map<string, CreditRenewalRecord>();
    for (const r of [...liveRenewalsForLoan, ...firestoreRenewals]) {
      byId.set(r.id, r);
    }
    liveRenewalsForLoan = Array.from(byId.values());
  } catch {
    // Fallback to in-memory state if query fails (e.g. unit test / offline cache)
  }

  const eligibility = evaluateLoanRenewalEligibility({
    loan: originLoan,
    installments: originInstallments,
    payments: originPayments,
    existingRenewals: liveRenewalsForLoan,
    customer,
    account: originCollectionAccount,
    creditPolicy: policy,
    collectionPolicy,
    asOfDateIso,
  });

  if (!eligibility.eligible) {
    throw new Error(
      eligibility.blockingReasons[0] ||
        'El préstamo seleccionado no cumple con las políticas vigentes para renovación.'
    );
  }

  const { breakdown: initialPayoffBreakdown } = computeRenewalPayoffBreakdown({
    loan: originLoan,
    installments: originInstallments,
    payments: originPayments,
    customer,
    account: originCollectionAccount,
    policy: collectionPolicy,
    asOfDateIso,
  });

  const isSameConditions = modality === 'MISMAS_CONDICIONES';
  const originRateMonthly = normalizeMonthlyRateDecimal(originLoan.contractualRateMonthly, 0.04);
  const originPrincipal = Number(
    (originLoan.approvedPrincipal || originLoan.totalFinancedPrincipal || 0).toFixed(2)
  );

  const targetProductCode: ProductCode = isSameConditions
    ? originLoan.productCode
    : params.productCode || originLoan.productCode;
  const targetCurrency = originLoan.currency;
  const targetAmount = Number(
    (isSameConditions ? originPrincipal : Number(params.requestedAmount ?? originPrincipal)).toFixed(2)
  );
  const targetTermMonths = Math.max(
    1,
    Math.min(
      360,
      Math.round(
        isSameConditions
          ? originLoan.termMonths
          : Number(params.requestedTermMonths ?? originLoan.termMonths)
      )
    )
  );
  const targetRateMonthly = normalizeMonthlyRateDecimal(
    isSameConditions ? originRateMonthly : params.requestedRateMonthly ?? originRateMonthly,
    originRateMonthly
  );
  const targetFrequency: PaymentFrequency = isSameConditions
    ? originLoan.frequency
    : params.paymentFrequency || originLoan.frequency;
  const targetAmortization: AmortizationMethod = isSameConditions
    ? originLoan.amortizationMethod
    : params.amortizationMethod || originLoan.amortizationMethod;
  const targetLegalFeeMode: LegalFeeApplicationMode =
    params.legalFeeMode || originApplication?.legalFeeMode || 'DESCONTAR_DESEMBOLSO';

  // Hard block if new amount does not exceed cancellation balance (net disbursement <= 0)
  const netCalc = calculateRenewalNetDisbursement({
    grossApprovedAmount: targetAmount,
    payoffAmount: initialPayoffBreakdown.totalPayoffAmount,
    otherAuthorizedDiscounts: 0,
  });

  if (!netCalc.valid) {
    throw new Error(
      netCalc.reason ||
        `El monto solicitado (${formatMoney(targetAmount, targetCurrency)}) no cubre el saldo de cancelación (${formatMoney(initialPayoffBreakdown.totalPayoffAmount, targetCurrency)}).`
    );
  }

  const nowIso = new Date().toISOString();
  const suffix = String(Date.now()).slice(-6);
  const renewalId = `ren_${sanitizeIdSegment(originLoan.id)}_${suffix}`.slice(0, 120);
  const renewalNumber = `REN-${new Date().getFullYear()}-${suffix}`;
  const appId = generateId('app').slice(0, 120);
  const appNumber = `SOL-REN-${new Date().getFullYear()}-${suffix}`;
  const fileNumber = `EXP-REN-${new Date().getFullYear()}-${suffix}`;

  const customerName =
    `${customer.firstName || ''} ${customer.lastName || ''}`.trim() ||
    originLoan.applicantDisplayName ||
    'Cliente';

  const coDebtorsSnapshot =
    params.coDebtors && params.coDebtors.length > 0
      ? params.coDebtors.slice(0, 4)
      : (originApplication?.references ?? []).slice(0, 4).map((r) => ({
          fullName: r.name,
          phone: r.phone,
          relationship: r.relationship,
        }));

  const guaranteesSnapshot = (
    params.proposedCollateral !== undefined
      ? params.proposedCollateral
      : originApplication?.proposedCollateral || ''
  )
    .trim()
    .slice(0, 1950);

  // Target workflow routing:
  // Modalidad A (MISMAS_CONDICIONES) -> Directo a Comité de Créditos (skips ordinary Evaluation, Committee retains decision authority)
  // Modalidad B (AUMENTO_O_MODIFICACION) -> Envía automáticamente a Evaluación
  const initialAppStatus: ApplicationRecord['status'] = isSameConditions
    ? 'EN_COMITE'
    : 'EN_EVALUACION';
  const initialRenewalStatus: CreditRenewalRecord['status'] = isSameConditions
    ? 'PENDIENTE_COMITE'
    : 'PENDIENTE_EVALUACION';

  const installmentCount = computeInstallmentCountFromMonths(targetTermMonths, targetFrequency);
  const baseFinancialData = originApplication?.verifiedFinancialData ??
    originApplication?.financialData ?? {
      activityType: 'Independiente / Renovación',
      incomeSourceType: 'FIJA_RECURRENTE' as const,
      primaryNetIncome: Math.max(targetAmount * 0.25, 25000),
      additionalIncomeStatus: 'EXPLICIT_NONE' as const,
      additionalNetIncome: 0,
      declaredTotalMonthlyIncome: Math.max(targetAmount * 0.25, 25000),
      essentialExpenses: Math.max(targetAmount * 0.08, 8000),
      incomeCurrency: targetCurrency,
      employmentMonths: 24,
      debtDeclarationStatus: 'NO_DEBTS_EXPLICIT' as const,
      currentDebtPayments: 0,
    };

  const draftApplication: ApplicationRecord = {
    id: appId,
    organizationId,
    applicationNumber: appNumber,
    fileNumber,
    channel: 'INTERNAL',
    applicantType: originLoan.businessId ? 'BUSINESS' : 'INDIVIDUAL',
    customerId: customer.id,
    businessId: originLoan.businessId ?? originApplication?.businessId ?? null,
    applicantDisplayName: customerName.slice(0, 200),
    productCode: targetProductCode,
    currency: targetCurrency,
    requestedAmount: targetAmount,
    requestedTermMonths: targetTermMonths,
    paymentFrequency: targetFrequency,
    amortizationMethod: targetAmortization,
    loanPurpose: isSameConditions
      ? 'Renovación / Reenganche (Mismas Condiciones)'
      : 'Renovación con Aumento o Modificación de Condiciones',
    loanPurposeDescription: (
      params.justification?.trim() ||
      `Renovación del préstamo ${originLoan.loanNumber} (Saldo de cancelación estimado: ${formatMoney(initialPayoffBreakdown.totalPayoffAmount, targetCurrency)}).`
    ).slice(0, 1000),
    proposedCollateral: guaranteesSnapshot,
    financialData: baseFinancialData,
    businessFinancialData:
      originApplication?.verifiedBusinessFinancialData ??
      originApplication?.businessFinancialData ??
      null,
    references: (originApplication?.references ?? []).slice(0, 4),
    declaredDocumentsSummary: originApplication?.declaredDocumentsSummary ?? {
      hasIdentityDoc: true,
      hasIncomeEvidence: true,
      hasAddressProof: true,
    },
    status: initialAppStatus,
    legalFeeMode: targetLegalFeeMode,
    installmentCount,
    interestOnlyPeriods: 0,
    consentVersion: originApplication?.consentVersion || 'v1.0-Ley172-13',
    consentAcceptedAt: nowIso,
    isRenewal: true,
    renewalId,
    renewalModality: modality,
    originLoanId: originLoan.id,
    originLoanNumber: originLoan.loanNumber,
    originPayoffSnapshot: initialPayoffBreakdown,
    createdBy: user.uid,
    createdByName: (user.displayName || user.email || 'Oficial AxyCore').slice(0, 160),
    movementHistory: appendMovementHistory([], {
      timestamp: nowIso,
      action: isSameConditions
        ? `Renovación iniciada (${renewalNumber} · Mismas Condiciones) sobre ${originLoan.loanNumber} -> Enviada directo a Comité`
        : `Renovación iniciada (${renewalNumber} · Aumento/Modificación) sobre ${originLoan.loanNumber} -> Enviada a Evaluación`,
      toStatus: initialAppStatus,
      userId: user.uid,
      userName: user.displayName || user.email || 'Usuario',
      userRole: user.role,
      note: `Saldo cancelación estimado: ${formatMoney(initialPayoffBreakdown.totalPayoffAmount, targetCurrency)} · Neto estimado: ${formatMoney(netCalc.netDisbursementAmount, targetCurrency)}`,
    }),
  };

  // Run integrated Decision Engine V2 + Financial Calculation so Scoring & Amortization exist immediately
  const allowCustomRate = canUserOverrideRateOrFees(user.role);
  const integrated = runIntegratedDecisionAndCalculation({
    application: draftApplication,
    customer,
    policy: policy ?? DEFAULT_POLICY_V2,
    analysisType: 'SOLICITUD_INICIAL',
    version: 1,
    useVerifiedData: false,
    alternativeConditions: {
      requestedAmount: targetAmount,
      termMonths: targetTermMonths,
      installmentCount,
      paymentFrequency: targetFrequency,
      amortizationMethod: targetAmortization,
      useSuggestedRate: !allowCustomRate,
      customMonthlyRatePct: allowCustomRate ? Number((targetRateMonthly * 100).toFixed(4)) : null,
      legalFeeMode: targetLegalFeeMode,
    },
    justification: params.justification?.trim() || `Solicitud de renovación ${renewalNumber}`,
    actor: {
      uid: user.uid,
      displayName: user.displayName || user.email || 'Usuario AxyCore',
      role: user.role,
    },
    intent: 'EVALUATE_ONLY',
  });

  const scoringId = integrated.scoring.id;
  const analysisId = integrated.analysis.id;
  const estimatedInstallment =
    integrated.analysis.financialSummary?.initialInstallment ??
    integrated.scoring.recommendedInstallment ??
    0;

  const finalApplication: ApplicationRecord = sanitizeFirestorePayload({
    ...draftApplication,
    prequalificationStatus: integrated.scoring.status,
    latestScoringExecutionId: scoringId,
    latestScore: integrated.scoring.totalScore,
    latestRiskBand: integrated.scoring.riskBand.label,
    recommendedAmount: targetAmount,
    recommendedRateMonthly: targetRateMonthly,
    recommendedTermMonths: targetTermMonths,
    recommendedInstallment: estimatedInstallment,
    originalRequestedConditions: buildOriginalRequestedConditions(draftApplication),
    activeFinancialAnalysisId: analysisId,
    requiresHumanIntervention: !isSameConditions,
    decisionQualificationStatus: isSameConditions
      ? 'CALIFICA_AUTO_EVALUACION'
      : 'REQUIERE_INTERVENCION_HUMANA',
    financialAnalysisVersion: 1,
  });

  const originInstallmentEstimate =
    originInstallments[0]?.totalAmount ??
    Number(
      (
        (originLoan.totalContractualPayable || originPrincipal) /
        Math.max(1, originInstallments.length || originLoan.termMonths)
      ).toFixed(2)
    );

  const renewalRecord: CreditRenewalRecord = sanitizeFirestorePayload({
    id: renewalId,
    organizationId,
    renewalNumber,
    customerId: customer.id,
    customerName: customerName.slice(0, 200),
    originLoanId: originLoan.id,
    originLoanNumber: originLoan.loanNumber,
    originProductCode: originLoan.productCode,
    originCurrency: originLoan.currency,
    originAmount: originPrincipal,
    originRateMonthly,
    originTermMonths: originLoan.termMonths,
    originFrequency: originLoan.frequency,
    originAmortizationMethod: originLoan.amortizationMethod,
    targetLoanId: null,
    targetLoanNumber: null,
    applicationId: appId,
    applicationNumber: appNumber,
    formalizationId: null,
    disbursementId: null,
    accountingEntryId: null,
    modality,
    status: initialRenewalStatus,
    currency: targetCurrency,
    productCode: targetProductCode,
    requestedAmount: targetAmount,
    recommendedAmount: targetAmount,
    approvedAmount: null,
    requestedRateMonthly: targetRateMonthly,
    requestedTermMonths: targetTermMonths,
    requestedFrequency: targetFrequency,
    requestedAmortizationMethod: targetAmortization,
    originConditions: {
      principal: originPrincipal,
      rateMonthly: originRateMonthly,
      termMonths: originLoan.termMonths,
      frequency: originLoan.frequency,
      amortizationMethod: originLoan.amortizationMethod,
      installmentAmount: originInstallmentEstimate,
      productCode: originLoan.productCode,
    },
    requestedConditions: {
      amount: targetAmount,
      rateMonthly: targetRateMonthly,
      termMonths: targetTermMonths,
      frequency: targetFrequency,
      amortizationMethod: targetAmortization,
      installmentAmount: estimatedInstallment,
      productCode: targetProductCode,
      legalFeeMode: targetLegalFeeMode,
    },
    approvedConditions: null,
    payoffSnapshot: initialPayoffBreakdown,
    initialPayoffBreakdown,
    finalPayoffBreakdown: null,
    originPaymentBehavior: {
      totalInstallments: initialPayoffBreakdown.totalInstallmentsCount,
      paidInstallments: eligibility.paidInstallmentsCount,
      overdueInstallments: initialPayoffBreakdown.overdueInstallmentsCount,
      paidPercentage: eligibility.paidPercent,
      currentDpd: initialPayoffBreakdown.dpd,
      maxHistoricalDpd: originCollectionAccount?.maxHistoricalDpd ?? initialPayoffBreakdown.dpd,
      paymentsCount: initialPayoffBreakdown.paymentsCount,
      behaviorSummary: eligibility.behaviorSummary,
    },
    paymentBehaviorSummary: eligibility.behaviorSummary,
    collateralSummary: guaranteesSnapshot || null,
    coDebtorsSummary:
      coDebtorsSnapshot.length > 0
        ? coDebtorsSnapshot.map((c) => `${c.fullName}${c.relationship ? ` (${c.relationship})` : ''}`).join(', ')
        : null,
    guaranteesSnapshot,
    coDebtorsSnapshot,
    grossApprovedAmount: targetAmount,
    settledPayoffAmount: initialPayoffBreakdown.totalPayoffAmount,
    otherDeductionsAmount: 0,
    netDisbursementAmount: netCalc.netDisbursementAmount,
    initiatedBy: user.uid,
    initiatedByName: (user.displayName || user.email || 'Usuario AxyCore').slice(0, 160),
    justification: (params.justification || '').trim().slice(0, 2000),
    idempotencyKey: `ren_init_${sanitizeIdSegment(originLoan.id)}_${suffix}`.slice(0, 128),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const batch = writeBatch(db);
  batch.set(doc(db, 'applications', appId), {
    ...finalApplication,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'scoring_executions', scoringId), {
    ...sanitizeFirestorePayload(integrated.scoring),
    executedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'financial_analyses', analysisId), {
    ...sanitizeFirestorePayload(integrated.analysis),
    calculatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'credit_renewals', renewalId), renewalRecord);

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId,
      eventType: 'CREDIT_RENEWAL_INITIATED',
      entityType: 'credit_renewals',
      entityId: renewalId,
      action: `Renovación ${renewalNumber} (${modality}) iniciada para préstamo ${originLoan.loanNumber} -> ${appNumber} (${initialAppStatus})`,
      previousState: originLoan.status,
      newState: initialRenewalStatus,
      justification: `Monto solicitado: ${formatMoney(targetAmount, targetCurrency)} | Saldo liquidación: ${formatMoney(initialPayoffBreakdown.totalPayoffAmount, targetCurrency)} | Neto proyectado: ${formatMoney(netCalc.netDisbursementAmount, targetCurrency)}`,
      transactionId: generateId('tx'),
      userId: user.uid,
      userEmail: user.email,
      userRole: user.role,
    }),
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `credit_renewals/${renewalId}`);
  }

  return {
    renewal: renewalRecord,
    application: finalApplication,
  };
}

export async function cancelRenewalByUser(params: {
  renewal: CreditRenewalRecord;
  application?: ApplicationRecord | null;
  reason: string;
  user: UserProfile;
}): Promise<void> {
  const { renewal, application, reason, user } = params;
  if (!ACTIVE_IN_FLIGHT_RENEWAL_STATUSES.has(renewal.status) && renewal.status !== 'ERROR_EJECUCION') {
    throw new Error(
      `No se puede cancelar una renovación en estado ${renewal.status}.`
    );
  }

  const nowIso = new Date().toISOString();
  const safeReason = reason.trim().slice(0, 1500) || 'Cancelada por usuario antes del desembolso';
  const batch = writeBatch(db);

  batch.update(doc(db, 'credit_renewals', renewal.id), {
    status: 'CANCELADA_USUARIO',
    rejectionReason: safeReason,
    updatedAt: serverTimestamp(),
  });

  if (application && application.status !== 'DESEMBOLSADA') {
    batch.update(doc(db, 'applications', application.id), {
      status: 'RECHAZADA',
      movementHistory: appendMovementHistory(application.movementHistory, {
        timestamp: nowIso,
        action: `Renovación ${renewal.renewalNumber} cancelada por usuario (préstamo origen ${renewal.originLoanNumber} permanece vigente)`,
        fromStatus: application.status,
        toStatus: 'RECHAZADA',
        userId: user.uid,
        userName: user.displayName || user.email || 'Usuario',
        userRole: user.role,
        note: safeReason,
      }),
      updatedAt: serverTimestamp(),
    });
  }

  const auditId = generateId('audit');
  batch.set(doc(db, 'audit_logs', auditId), {
    ...buildCriticalAuditEntryPayload({
      id: auditId,
      organizationId: renewal.organizationId,
      eventType: 'CREDIT_RENEWAL_CANCELLED',
      entityType: 'credit_renewals',
      entityId: renewal.id,
      action: `Renovación ${renewal.renewalNumber} cancelada por usuario; préstamo origen ${renewal.originLoanNumber} sin alteraciones`,
      previousState: renewal.status,
      newState: 'CANCELADA_USUARIO',
      justification: safeReason,
      transactionId: generateId('tx'),
      userId: user.uid,
      userEmail: user.email,
      userRole: user.role,
    }),
    timestamp: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `credit_renewals/${renewal.id}`);
  }
}
