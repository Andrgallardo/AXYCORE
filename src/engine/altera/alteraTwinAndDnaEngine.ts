import type {
  AlteraConfigRecord,
  AlteraCreditDigitalTwin,
  AlteraDeteriorationTrend,
  AlteraExplainabilityBlock,
  AlteraFinancialDna,
  AlteraInstallmentPatternSummary,
  AlteraInterventionType,
  AlteraPortfolioIntelligenceSummary,
  AlteraPreventiveSignal,
  AlteraPriority,
  AlteraRecommendationRecord,
  AlteraSavedScenarioRecord,
  AlteraUniverseParameters,
} from '../../types/altera';
import type {
  ApplicationRecord,
  CollectionAccountRecord,
  CollectionActionRecord,
  CollectionPolicyVersionRecord,
  CreditEvaluationRecord,
  CreditPolicyRecord,
  CurrencyCode,
  CustomerDisputeRecord,
  CustomerRecord,
  LoanInstallmentRecord,
  LoanRecord,
  PaymentAgreementRecord,
  PaymentPromiseRecord,
  PaymentRecord,
  RiskAlertRecord,
  RiskBandCode,
} from '../../types/axycore';
import {
  DEFAULT_COLLECTION_POLICY_V1,
  addCalendarDays,
  computeInstallmentRemaining,
  diffCalendarDays,
  evaluateLoanDelinquency,
  fromCents,
  getSantoDomingoTodayIso,
  toCents,
} from '../collections/delinquencyEngine';

export function buildDefaultAlteraConfig(organizationId: string): AlteraConfigRecord {
  return {
    id: `altera_cfg_${organizationId}`,
    organizationId,
    earlyDeteriorationDelayThresholdDays: 3,
    minPunctualityPctForHealthy: 85,
    maxRestructureExtensionMonths: 12,
    maxTemporaryReductionPct: 40,
    maxTemporaryReductionMonths: 3,
    maxDueDateShiftDays: 15,
    minConfidenceForPriorityAlertPct: 68,
    preventiveHorizonDays: 30,
    deteriorationWeights: {
      delayTrendWeight: 30,
      brokenPromisesWeight: 25,
      overdueRatioWeight: 25,
      behavioralShiftWeight: 20,
    },
    calibrationFactorPct: 0,
    requireHumanApprovalForAllInterventions: true,
    updatedBy: 'system',
    updatedByName: 'Motor ALTERA v1.0',
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mapDeteriorationToPriority(score: number, dpd: number): AlteraPriority {
  if (score >= 78 || dpd >= 60) return 'CRITICA';
  if (score >= 55 || dpd >= 16) return 'ALTA';
  if (score >= 32 || dpd >= 1) return 'MEDIA';
  return 'BAJA';
}

function maskDocumentNumber(docNum?: string): string {
  if (!docNum) return 'Sin documento';
  const clean = docNum.trim();
  if (clean.length <= 4) return clean;
  return `***-${clean.slice(-4)}`;
}

export function buildCreditDigitalTwin(params: {
  loan: LoanRecord;
  installments: LoanInstallmentRecord[];
  payments: PaymentRecord[];
  collectionAccount?: CollectionAccountRecord | null;
  promises?: PaymentPromiseRecord[];
  agreements?: PaymentAgreementRecord[];
  disputes?: CustomerDisputeRecord[];
  riskAlerts?: RiskAlertRecord[];
  customer?: CustomerRecord | null;
  collectionPolicy?: CollectionPolicyVersionRecord;
  alteraConfig?: AlteraConfigRecord;
  asOfDateIso?: string;
}): AlteraCreditDigitalTwin {
  const {
    loan,
    installments,
    payments,
    collectionAccount,
    promises = [],
    agreements = [],
    disputes = [],
    riskAlerts = [],
    customer,
    collectionPolicy = DEFAULT_COLLECTION_POLICY_V1,
    alteraConfig = buildDefaultAlteraConfig(loan.organizationId),
    asOfDateIso = getSantoDomingoTodayIso(),
  } = params;

  const sortedInsts = [...installments]
    .filter((i) => i.loanId === loan.id)
    .sort((a, b) => a.installmentNumber - b.installmentNumber);

  // Derive consistent real-time delinquency snapshot without mutating inputs
  const delinquencyEval = evaluateLoanDelinquency({
    loan,
    installments: sortedInsts,
    customer: customer ?? null,
    policy: collectionPolicy,
    asOfDateIso,
    existingAccount: collectionAccount ?? null,
    promises: promises.filter((p) => p.loanId === loan.id),
    payments: payments.filter((p) => p.loanId === loan.id),
    disputes: disputes.filter((d) => d.loanId === loan.id),
  });

  const acc = delinquencyEval.account;
  const evalInsts = delinquencyEval.updatedInstallments;

  const loanPayments = payments
    .filter((p) => p.loanId === loan.id && p.status === 'APLICADO')
    .sort((a, b) => String(a.paymentDate).localeCompare(String(b.paymentDate)));

  let paidOnTimeCount = 0;
  let paidLateCount = 0;
  let partialCount = 0;
  let overdueCount = 0;
  let pendingCount = 0;
  let maxHistoricalDelayDays = acc.maxHistoricalDpd || 0;
  const paidDelays: number[] = [];
  const delayByInstOrder: number[] = [];

  const timelineSeries = evalInsts.map((inst) => {
    const rem = computeInstallmentRemaining(inst);
    const scheduledAmount = Number(inst.totalAmount || 0);
    const paidAmount = round1(
      (inst.paidPrincipal ?? 0) +
        (inst.paidInterest ?? 0) +
        (inst.paidOtherCharges ?? 0) +
        (inst.paidLateFee ?? 0)
    );

    let delayDays = 0;
    if (rem.isPaid || inst.status === 'PAGADA') {
      const refPaidDate = (inst.paidAt || '').slice(0, 10) || inst.dueDate;
      delayDays = Math.max(0, diffCalendarDays(inst.dueDate, refPaidDate));
      paidDelays.push(delayDays);
      delayByInstOrder.push(delayDays);
      if (delayDays <= (collectionPolicy.graceDays ?? 3)) {
        paidOnTimeCount += 1;
      } else {
        paidLateCount += 1;
      }
    } else if (inst.dueDate < asOfDateIso) {
      delayDays = Math.max(0, diffCalendarDays(inst.dueDate, asOfDateIso));
      delayByInstOrder.push(delayDays);
      if (inst.status === 'PARCIAL') {
        partialCount += 1;
      } else {
        overdueCount += 1;
      }
    } else {
      pendingCount += 1;
    }
    if (delayDays > maxHistoricalDelayDays) {
      maxHistoricalDelayDays = delayDays;
    }

    return {
      periodLabel: `C${inst.installmentNumber}`,
      installmentNumber: inst.installmentNumber,
      scheduledAmount,
      paidAmount,
      delayDays,
      remainingPrincipal: inst.remainingPrincipalBalance,
      status: inst.status,
    };
  });

  const paidCount = paidOnTimeCount + paidLateCount;
  const totalEvaluatedPastOrPaid = paidCount + partialCount + overdueCount;
  const punctualityRatePct =
    totalEvaluatedPastOrPaid > 0
      ? round1((paidOnTimeCount / totalEvaluatedPastOrPaid) * 100)
      : acc.dpd === 0
      ? 100
      : 0;

  const avgDelayDaysOnPaid =
    paidDelays.length > 0
      ? round1(paidDelays.reduce((s, d) => s + d, 0) / paidDelays.length)
      : 0;

  const recentSlice = delayByInstOrder.slice(-3);
  const previousSlice = delayByInstOrder.slice(0, Math.max(0, delayByInstOrder.length - 3));
  const recent3Avg =
    recentSlice.length > 0
      ? round1(recentSlice.reduce((s, d) => s + d, 0) / recentSlice.length)
      : 0;
  const prevAvg =
    previousSlice.length > 0
      ? round1(previousSlice.reduce((s, d) => s + d, 0) / previousSlice.length)
      : recent3Avg;
  const behavioralShiftDeltaDays = round1(recent3Avg - prevAvg);

  const patterns: AlteraInstallmentPatternSummary = {
    totalInstallments: evalInsts.length || loan.termMonths,
    paidCount,
    paidOnTimeCount,
    paidLateCount,
    partialCount,
    overdueCount,
    pendingCount,
    punctualityRatePct,
    avgDelayDaysOnPaid,
    maxHistoricalDelayDays,
    recent3InstallmentsAvgDelayDays: recent3Avg,
    previousInstallmentsAvgDelayDays: prevAvg,
    behavioralShiftDeltaDays,
  };

  // Compute deterministic Deterioration Score (0 - 100)
  const w = alteraConfig.deteriorationWeights;
  const brokenPromises = promises.filter(
    (p) => p.loanId === loan.id && p.status === 'INCUMPLIDA'
  ).length;
  const activeAlertsCount = riskAlerts.filter(
    (a) => a.loanId === loan.id && ['ACTIVA', 'EN_REVISION'].includes(a.status)
  ).length;
  const hasActiveRestructure = agreements.some(
    (a) =>
      a.loanId === loan.id &&
      ['APROBADO', 'ACTIVO'].includes(a.status) &&
      a.agreementType !== 'ACUERDO_PAGO'
  );
  const openDisputesCount = disputes.filter(
    (d) => d.loanId === loan.id && ['ABIERTA', 'EN_INVESTIGACION'].includes(d.status)
  ).length;

  const dpdFactor = clamp(acc.dpd / 60, 0, 1);
  const brokenFactor = clamp(brokenPromises / 2, 0, 1);
  const overdueRatio =
    acc.totalOutstandingPrincipal > 0
      ? clamp(acc.overdueTotalAmount / acc.totalOutstandingPrincipal, 0, 1)
      : 0;
  const shiftFactor =
    behavioralShiftDeltaDays > 0
      ? clamp(behavioralShiftDeltaDays / 15, 0, 1)
      : Math.max(0, (100 - punctualityRatePct) / 100) * 0.5;

  const totalWeights =
    w.delayTrendWeight + w.brokenPromisesWeight + w.overdueRatioWeight + w.behavioralShiftWeight || 100;
  const baseDeterioration =
    ((dpdFactor * w.delayTrendWeight +
      brokenFactor * w.brokenPromisesWeight +
      overdueRatio * w.overdueRatioWeight +
      shiftFactor * w.behavioralShiftWeight) /
      totalWeights) *
    100;

  const extraPenalty =
    (activeAlertsCount > 0 ? 6 : 0) +
    (partialCount >= 2 ? 5 : 0) +
    (openDisputesCount > 0 ? 4 : 0) +
    (acc.dpd === 0 && behavioralShiftDeltaDays >= alteraConfig.earlyDeteriorationDelayThresholdDays ? 8 : 0);

  const calibrationOffset = alteraConfig.calibrationFactorPct ?? 0;
  const isClosed = loan.status === 'PAGADO' || loan.status === 'CANCELADO' || acc.totalOutstandingPrincipal <= 0;
  const deteriorationScore = isClosed
    ? 0
    : Math.round(clamp(baseDeterioration + extraPenalty + calibrationOffset * 0.25, 4, 98));

  const recoveryProbabilityPct = isClosed
    ? 100
    : round1(clamp(96 - deteriorationScore * 0.62 - brokenPromises * 4 + (punctualityRatePct >= 85 ? 5 : 0), 12, 99));

  const projected30DayDpd =
    isClosed
      ? 0
      : acc.dpd > 0
      ? acc.dpd + 30
      : behavioralShiftDeltaDays >= alteraConfig.earlyDeteriorationDelayThresholdDays
      ? 8
      : 0;

  const projected60DayBalanceAtRisk =
    isClosed || (acc.dpd === 0 && deteriorationScore < 35)
      ? 0
      : fromCents(
          Math.round(
            toCents(acc.totalOutstandingPrincipal) *
              clamp((deteriorationScore / 100) * 0.85, 0.1, 1)
          )
        );

  let trend: AlteraDeteriorationTrend = 'ESTABLE_SALUDABLE';
  if (isClosed) {
    trend = 'ESTABLE_SALUDABLE';
  } else if (acc.dpd >= 31 || (acc.dpd >= 15 && brokenPromises >= 1)) {
    trend = 'DETERIORO_ACELERADO';
  } else if (acc.dpd >= 6 || brokenPromises >= 1 || partialCount >= 2) {
    trend = 'DETERIORO_MODERADO';
  } else if (
    acc.dpd > 0 ||
    behavioralShiftDeltaDays >= alteraConfig.earlyDeteriorationDelayThresholdDays ||
    (acc.nextDueDate && diffCalendarDays(asOfDateIso, acc.nextDueDate) <= 5 && maxHistoricalDelayDays >= 4)
  ) {
    trend = 'SENAL_TEMPRANA';
  } else if (hasActiveRestructure && acc.dpd === 0) {
    trend = 'RECUPERACION_EN_CURSO';
  }

  const signalsDetected: string[] = [];
  if (acc.dpd > 0) {
    signalsDetected.push(`Mora activa de ${acc.dpd} días en tramo ${acc.stage} (${acc.currency} ${acc.overdueTotalAmount.toFixed(2)} vencidos).`);
  }
  if (behavioralShiftDeltaDays >= alteraConfig.earlyDeteriorationDelayThresholdDays) {
    signalsDetected.push(
      `Desplazamiento conductual: atraso promedio subió de ${prevAvg} a ${recent3Avg} días en las últimas 3 cuotas.`
    );
  }
  if (brokenPromises > 0) {
    signalsDetected.push(`${brokenPromises} promesa(s) de pago incumplida(s) registrada(s) en el historial.`);
  }
  if (partialCount > 0) {
    signalsDetected.push(`${partialCount} cuota(s) con pago parcial pendiente de regularización.`);
  }
  if (activeAlertsCount > 0) {
    signalsDetected.push(`${activeAlertsCount} alerta(s) Centinela activa(s) vinculada(s) al préstamo.`);
  }
  if (signalsDetected.length === 0 && !isClosed) {
    signalsDetected.push('Comportamiento puntual estable sin señales de deterioro inmediato.');
  }

  const recentvsHistoricalSummary =
    delayByInstOrder.length === 0
      ? 'Sin cuotas vencidas o pagadas aún; seguimiento basado en fecha de próximo vencimiento.'
      : behavioralShiftDeltaDays > 2
      ? `Deterioro reciente (+${behavioralShiftDeltaDays} días promedio frente al tramo inicial).`
      : behavioralShiftDeltaDays < -2
      ? `Mejoría conductual (${behavioralShiftDeltaDays} días promedio frente al historial previo).`
      : `Consistencia estable (atraso reciente ${recent3Avg}d vs histórico ${prevAvg}d).`;

  const remainingTermInstallments = evalInsts.filter((i) => !computeInstallmentRemaining(i).isPaid).length;

  const dataLimitations: string[] = [];
  if (evalInsts.length === 0) {
    dataLimitations.push('El préstamo no posee tabla de cuotas detallada en loan_installments; métricas estimadas desde cabecera LoanRecord.');
  }
  if (loanPayments.length === 0) {
    dataLimitations.push('Sin pagos aplicados registrados todavía en colección payments.');
  }

  const confidenceBase = evalInsts.length >= 3 ? 88 : evalInsts.length > 0 ? 74 : 58;
  const confidencePct = Math.round(clamp(confidenceBase - (dataLimitations.length * 6), 45, 96));

  const explainability: AlteraExplainabilityBlock = {
    whatWasDetected: signalsDetected[0] || 'Seguimiento crediticio estable',
    dataUsed: [
      `Préstamo ${loan.loanNumber} (${loan.currency} ${loan.approvedPrincipal.toLocaleString()})`,
      `${evalInsts.length} cuotas analizadas en loan_installments`,
      `${loanPayments.length} pagos aplicados en payments`,
      `${brokenPromises} promesas incumplidas · ${activeAlertsCount} alertas Centinela`,
    ],
    whyRiskOrOpportunityExists:
      deteriorationScore >= 55
        ? 'Concurren días de atraso activos, pérdida de puntualidad reciente o incumplimiento de promesas previas que elevan la probabilidad de migración a tramo superior.'
        : deteriorationScore >= 30
        ? 'Se detectan señales tempranas de fricción de liquidez (retraso marginal o pago parcial) que responden bien a intervención preventiva antes de generar mora dura.'
        : 'Historial puntual y baja varianza entre fecha pactada y fecha efectiva de pago.',
    variablesConsidered: [
      { label: 'Días de atraso (DPD actual)', value: `${acc.dpd} días`, weightOrImpact: `Peso ${w.delayTrendWeight}%` },
      { label: 'Puntualidad histórica', value: `${punctualityRatePct}%`, weightOrImpact: `Desvío reciente ${behavioralShiftDeltaDays >= 0 ? '+' : ''}${behavioralShiftDeltaDays}d` },
      { label: 'Promesas incumplidas', value: String(brokenPromises), weightOrImpact: `Peso ${w.brokenPromisesWeight}%` },
      { label: 'Ratio vencido / capital', value: `${round1(overdueRatio * 100)}%`, weightOrImpact: `Peso ${w.overdueRatioWeight}%` },
    ],
    alternativesEvaluated: [
      'Continuidad operativa sin intervención',
      'Contacto preventivo o reajuste de fecha dentro de política',
      'Evaluación de acuerdo / reestructuración controlada',
    ],
    whyRecommended:
      deteriorationScore >= 55
        ? 'Priorizar contención temprana reduce la migración hacia PAR 60+ y protege el capital pendiente.'
        : 'Mantener monitoreo adaptativo y recordatorios preventivos evita deterioro innecesario.',
    expectedOutcomeIfNoAction:
      isClosed
        ? 'Préstamo cerrado sin exposición adicional.'
        : acc.dpd > 0
        ? `Sin intervención en 30 días el atraso proyectado alcanzaría ~${projected30DayDpd} DPD con ${loan.currency} ${projected60DayBalanceAtRisk.toFixed(2)} en riesgo a 60 días.`
        : 'Sin cambio de tendencia se proyecta continuidad regular del calendario vigente.',
    confidencePct,
    dataLimitations: dataLimitations.length > 0 ? dataLimitations : ['Datos transaccionales completos disponibles en AxyCore.'],
  };

  return {
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    customerId: loan.customerId,
    customerName: loan.applicantDisplayName,
    currency: loan.currency,
    productCode: loan.productCode,
    loanStatus: loan.status,
    collectionStage: acc.stage,
    dpdCurrent: acc.dpd,
    principalOriginal: loan.approvedPrincipal,
    currentPrincipalBalance: acc.totalOutstandingPrincipal,
    overduePrincipal: acc.overduePrincipal,
    overdueInterest: acc.overdueInterest,
    overdueLateFee: acc.overdueLateFee,
    overdueCharges: acc.overdueCharges,
    totalOverdue: acc.overdueTotalAmount,
    nextDueDate: acc.nextDueDate ?? null,
    nextDueAmount: acc.nextDueAmount ?? 0,
    contractualRateMonthlyPct: loan.contractualRateMonthly <= 1 ? round1(loan.contractualRateMonthly * 100) : loan.contractualRateMonthly,
    remainingTermInstallments,
    frequency: loan.frequency,
    amortizationMethod: loan.amortizationMethod,
    maturityDate: loan.maturityDate,
    disbursementDate: loan.disbursementDate,
    lastPaymentDate: acc.lastPaymentDate ?? null,
    lastPaymentAmount: acc.lastPaymentAmount ?? 0,
    patterns,
    deteriorationScore,
    recoveryProbabilityPct,
    projected30DayDpd,
    projected60DayBalanceAtRisk,
    trend,
    priority: mapDeteriorationToPriority(deteriorationScore, acc.dpd),
    signalsDetected,
    recentvsHistoricalSummary,
    timelineSeries,
    explainability,
  };
}

export function buildClientFinancialDna(params: {
  customer: CustomerRecord;
  loans: LoanRecord[];
  twins: AlteraCreditDigitalTwin[];
  payments: PaymentRecord[];
  promises: PaymentPromiseRecord[];
  agreements: PaymentAgreementRecord[];
  disputes: CustomerDisputeRecord[];
  applications: ApplicationRecord[];
  evaluations: CreditEvaluationRecord[];
}): AlteraFinancialDna {
  const { customer, loans, twins, payments, promises, agreements, disputes, applications, evaluations } = params;
  const custLoans = loans.filter((l) => l.customerId === customer.id);
  const custTwins = twins.filter((t) => t.customerId === customer.id);
  const custPays = payments.filter((p) => p.customerId === customer.id && p.status === 'APLICADO');
  const custPromises = promises.filter((p) => p.customerId === customer.id);
  const custAgreements = agreements.filter((a) => a.customerId === customer.id);
  const custDisputes = disputes.filter((d) => d.customerId === customer.id);
  const custApps = [...applications]
    .filter((a) => a.customerId === customer.id)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const sumByCurrency = (cur: CurrencyCode) => {
    const ls = custLoans.filter((l) => l.currency === cur);
    const orig = fromCents(ls.reduce((s, l) => s + toCents(l.approvedPrincipal), 0));
    const bal = fromCents(
      custTwins.filter((t) => t.currency === cur).reduce((s, t) => s + toCents(t.currentPrincipalBalance), 0)
    );
    const paid = fromCents(
      custPays.filter((p) => p.currency === cur).reduce((s, p) => s + toCents(p.amount), 0)
    );
    return { orig, bal, paid };
  };

  const dop = sumByCurrency('DOP');
  const usd = sumByCurrency('USD');
  const currenciesPresent = Array.from(new Set(custLoans.map((l) => l.currency))) as CurrencyCode[];

  const punctualitySum = custTwins.reduce((s, t) => s + t.patterns.punctualityRatePct, 0);
  const historicalPunctualityPct =
    custTwins.length > 0 ? round1(punctualitySum / custTwins.length) : 100;

  const totalOverdueEpisodes = custTwins.reduce(
    (s, t) => s + t.patterns.overdueCount + t.patterns.paidLateCount,
    0
  );
  const brokenPromisesCount = custPromises.filter((p) => p.status === 'INCUMPLIDA').length;
  const fulfilledPromisesCount = custPromises.filter((p) => p.status === 'CUMPLIDA').length;
  const agreementsOrRestructuresCount = custAgreements.filter(
    (a) => a.agreementType !== 'ACUERDO_PAGO' || a.status !== 'RECHAZADO'
  ).length;
  const openDisputesCount = custDisputes.filter((d) =>
    ['ABIERTA', 'EN_INVESTIGACION'].includes(d.status)
  ).length;

  // Strictly extract verified/declared income from real Application / Evaluation records (zero fabrication!)
  const latestApp = custApps[0];
  const latestEval = latestApp
    ? evaluations.find((e) => e.applicationId === latestApp.id)
    : undefined;

  const fin = latestApp?.verifiedFinancialData ?? latestApp?.financialData;
  const evalSnap = latestEval?.verifiedSnapshot as Record<string, unknown> | undefined;

  const rawPrimaryIncome =
    fin?.declaredTotalMonthlyIncome ??
    fin?.primaryNetIncome ??
    (typeof evalSnap?.primaryNetIncome === 'number' ? evalSnap.primaryNetIncome : null);
  const rawAdditionalIncome = fin?.additionalNetIncome ?? 0;
  const verifiedMonthlyIncome =
    rawPrimaryIncome !== null && rawPrimaryIncome !== undefined && rawPrimaryIncome > 0
      ? round1(rawPrimaryIncome + (rawAdditionalIncome || 0))
      : null;

  const verifiedMonthlyExpenses =
    fin?.essentialExpenses !== null && fin?.essentialExpenses !== undefined
      ? round1((fin.essentialExpenses || 0) + (fin.housingPayment || 0))
      : null;
  const verifiedExternalDebts =
    fin?.currentDebtPayments !== null && fin?.currentDebtPayments !== undefined
      ? round1(fin.currentDebtPayments)
      : null;

  const currentScheduledInstallmentsTotal = fromCents(
    custTwins
      .filter((t) => t.loanStatus === 'ACTIVO' || t.loanStatus === 'VENCIDO')
      .reduce((s, t) => s + toCents(t.nextDueAmount || 0), 0)
  );

  const incomeDataAvailable = verifiedMonthlyIncome !== null && verifiedMonthlyIncome > 0;
  const estimatedDebtServiceRatioPct =
    incomeDataAvailable && verifiedMonthlyIncome
      ? round1(
          (((verifiedExternalDebts ?? 0) + currentScheduledInstallmentsTotal) / verifiedMonthlyIncome) * 100
        )
      : null;

  const avgDet =
    custTwins.length > 0
      ? custTwins.reduce((s, t) => s + t.deteriorationScore, 0) / custTwins.length
      : 15;
  const adaptiveScore = Math.round(
    clamp(100 - avgDet - brokenPromisesCount * 6 + (fulfilledPromisesCount > 0 ? 4 : 0), 8, 99)
  );

  let dnaClassification: AlteraFinancialDna['dnaClassification'] = 'CUMPLIDOR_CONSISTENTE';
  if (adaptiveScore < 35 || custTwins.some((t) => t.dpdCurrent >= 45)) {
    dnaClassification = 'CRITICO_ALTA_EXPOSICION';
  } else if (agreementsOrRestructuresCount > 0 || brokenPromisesCount >= 2) {
    dnaClassification = 'REINCIDENTE_RECUPERABLE';
  } else if (custTwins.some((t) => t.trend === 'DETERIORO_MODERADO' || t.trend === 'SENAL_TEMPRANA')) {
    dnaClassification = 'ESTRÉS_LIQUIDEZ_TEMPRANO';
  } else if (totalOverdueEpisodes > 0 && historicalPunctualityPct >= 75) {
    dnaClassification = 'ESTACIONAL_SENSIBLE';
  }

  const behavioralSignature: string[] = [];
  behavioralSignature.push(`Puntualidad histórica consolidada: ${historicalPunctualityPct}% en ${custLoans.length} préstamo(s).`);
  if (brokenPromisesCount > 0 || fulfilledPromisesCount > 0) {
    behavioralSignature.push(`Compromisos de pago: ${fulfilledPromisesCount} cumplidos vs ${brokenPromisesCount} incumplidos.`);
  }
  if (agreementsOrRestructuresCount > 0) {
    behavioralSignature.push(`Registra ${agreementsOrRestructuresCount} acuerdo(s)/reestructuración(es) previa(s).`);
  }
  if (estimatedDebtServiceRatioPct !== null) {
    behavioralSignature.push(`Carga estimada cuotas+deudas sobre ingreso registrado: ${estimatedDebtServiceRatioPct}%.`);
  }

  const dataLimitations: string[] = [];
  if (!incomeDataAvailable) {
    dataLimitations.push(
      'Datos de ingresos y gastos mensuales no disponibles en solicitudes/evaluaciones vinculadas; no se infieren ni inventan cifras.'
    );
  }
  if (custLoans.length === 0) {
    dataLimitations.push('Cliente sin préstamos desembolsados aún en la entidad.');
  }

  const fullName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.id;
  const activeLoansCount = custLoans.filter((l) => l.status === 'ACTIVO' || l.status === 'VENCIDO').length;
  const closedLoansCount = custLoans.filter((l) => l.status === 'PAGADO' || l.status === 'CANCELADO').length;

  const interpretativeProfile =
    custLoans.length === 0
      ? `${fullName} no registra créditos activos o cerrados en AxyCore.`
      : `${fullName} presenta perfil ${dnaClassification.replace(/_/g, ' ').toLowerCase()} (Índice Adaptativo ${adaptiveScore}/100) con ${activeLoansCount} operación(es) activa(s) y puntualidad de ${historicalPunctualityPct}%. ${
          incomeDataAvailable
            ? `Ingreso registrado ${fin?.incomeCurrency || 'DOP'} ${verifiedMonthlyIncome?.toLocaleString()}.`
            : 'Sin declaración reciente de ingresos disponible para razón cuota/ingreso.'
        }`;

  return {
    customerId: customer.id,
    customerName: fullName,
    documentNumberMasked: maskDocumentNumber(customer.documentNumber),
    totalLoansCount: custLoans.length,
    activeLoansCount,
    closedLoansCount,
    currenciesPresent,
    totalOriginalPrincipalDop: dop.orig,
    totalCurrentBalanceDop: dop.bal,
    totalPaidAppliedDop: dop.paid,
    totalOriginalPrincipalUsd: usd.orig,
    totalCurrentBalanceUsd: usd.bal,
    totalPaidAppliedUsd: usd.paid,
    historicalPunctualityPct,
    totalOverdueEpisodes,
    brokenPromisesCount,
    fulfilledPromisesCount,
    agreementsOrRestructuresCount,
    openDisputesCount,
    incomeDataAvailable,
    verifiedIncomeCurrency: incomeDataAvailable ? fin?.incomeCurrency || latestApp?.currency || 'DOP' : null,
    verifiedMonthlyIncome,
    verifiedMonthlyExpenses,
    verifiedExternalDebts,
    currentScheduledInstallmentsTotal,
    estimatedDebtServiceRatioPct,
    lastOriginationScore: latestApp?.latestScore ?? null,
    lastOriginationRiskBand: (latestApp?.latestRiskBand as RiskBandCode) ?? null,
    dnaClassification,
    adaptiveScore,
    behavioralSignature,
    interpretativeProfile,
    dataLimitations,
  };
}

export function buildPreventivePlanBSignals(params: {
  twins: AlteraCreditDigitalTwin[];
  dnas: AlteraFinancialDna[];
  collectionAccounts: CollectionAccountRecord[];
  collectionActions: CollectionActionRecord[];
  riskAlerts: RiskAlertRecord[];
  policy?: CreditPolicyRecord;
  alteraConfig?: AlteraConfigRecord;
  asOfDateIso?: string;
}): AlteraPreventiveSignal[] {
  const {
    twins,
    dnas,
    collectionAccounts,
    collectionActions,
    riskAlerts,
    alteraConfig,
    asOfDateIso = getSantoDomingoTodayIso(),
  } = params;

  const dnaMap = new Map(dnas.map((d) => [d.customerId, d]));
  const accMap = new Map(collectionAccounts.map((a) => [a.loanId, a]));

  const signals: AlteraPreventiveSignal[] = [];

  for (const twin of twins) {
    if (twin.loanStatus === 'PAGADO' || twin.loanStatus === 'CANCELADO' || twin.currentPrincipalBalance <= 0) {
      continue;
    }

    const dna = dnaMap.get(twin.customerId);
    const acc = accMap.get(twin.loanId);
    const loanAlerts = riskAlerts.filter(
      (a) => a.loanId === twin.loanId && ['ACTIVA', 'EN_REVISION'].includes(a.status)
    );
    const recentActions = collectionActions.filter((a) => a.loanId === twin.loanId);
    const config = alteraConfig ?? buildDefaultAlteraConfig(acc?.organizationId || 'org_axycore_main');

    const isTrigger =
      twin.deteriorationScore >= 32 ||
      twin.dpdCurrent > 0 ||
      twin.patterns.behavioralShiftDeltaDays >= config.earlyDeteriorationDelayThresholdDays ||
      loanAlerts.length > 0 ||
      (dna ? dna.brokenPromisesCount > 0 : false);

    if (!isTrigger) continue;

    let suggestedInterventionType: AlteraInterventionType = 'ESTRATEGIA_COBRANZA_PREVENTIVA';
    let suggestedParams: AlteraUniverseParameters = {
      interventionType: 'ESTRATEGIA_COBRANZA_PREVENTIVA',
      preventiveContactChannel: twin.dpdCurrent >= 15 ? 'LLAMADA' : 'WHATSAPP',
    };
    let detectedRisk = '';
    let recommendedAction = '';
    let expectedImpactSummary = '';

    if (twin.dpdCurrent >= 30 || (dna && dna.brokenPromisesCount >= 2)) {
      suggestedInterventionType = 'REESTRUCTURACION_PLAZO';
      const newTerm = Math.min(twin.remainingTermInstallments + 4, twin.remainingTermInstallments + config.maxRestructureExtensionMonths);
      suggestedParams = {
        interventionType: 'REESTRUCTURACION_PLAZO',
        restructuredTermMonths: Math.max(4, newTerm),
        restructuredMonthlyRatePct: twin.contractualRateMonthlyPct,
      };
      detectedRisk = `Riesgo crítico de migración a mora avanzada/legal (${twin.dpdCurrent} DPD, ${twin.currency} ${twin.currentPrincipalBalance.toFixed(2)} expuestos).`;
      recommendedAction = `Evaluar reestructuración controlada extendiendo a ${suggestedParams.restructuredTermMonths} cuotas dentro de política para aliviar carga periódica.`;
      expectedImpactSummary = 'Reduce cuota periódica y eleva probabilidad estimada de recuperación en +14% a +22%.';
    } else if (twin.dpdCurrent >= 6 || twin.patterns.partialCount >= 1) {
      suggestedInterventionType = 'REDUCCION_TEMPORAL_CUOTA';
      suggestedParams = {
        interventionType: 'REDUCCION_TEMPORAL_CUOTA',
        temporaryReductionPct: Math.min(30, config.maxTemporaryReductionPct),
        temporaryReductionMonths: Math.min(2, config.maxTemporaryReductionMonths),
      };
      detectedRisk = `Presión de flujo de caja reflejada en ${twin.dpdCurrent} DPD o pagos parciales reiterados.`;
      recommendedAction = `Aplicar Plan B con reducción temporal de ${suggestedParams.temporaryReductionPct}% por ${suggestedParams.temporaryReductionMonths} meses condicionada a puntualidad.`;
      expectedImpactSummary = 'Contiene escalamiento de mora y preserva rendimiento contractual del saldo.';
    } else if (twin.patterns.behavioralShiftDeltaDays >= config.earlyDeteriorationDelayThresholdDays) {
      suggestedInterventionType = 'CAMBIO_FECHA_PAGO';
      suggestedParams = {
        interventionType: 'CAMBIO_FECHA_PAGO',
        dueDateShiftDays: Math.min(7, config.maxDueDateShiftDays),
      };
      detectedRisk = `Desfase recurrente de calendario (+${twin.patterns.behavioralShiftDeltaDays}d en últimas 3 cuotas).`;
      recommendedAction = `Alinear fecha de pago (+${suggestedParams.dueDateShiftDays} días) al ciclo real de liquidez del cliente.`;
      expectedImpactSummary = 'Elimina mora friccional sin sacrificio de capital ni intereses.';
    } else {
      suggestedInterventionType = 'ESTRATEGIA_COBRANZA_PREVENTIVA';
      suggestedParams = {
        interventionType: 'ESTRATEGIA_COBRANZA_PREVENTIVA',
        preventiveContactChannel: 'WHATSAPP',
      };
      detectedRisk = 'Señal temprana preventiva antes de consolidarse atraso en cartera.';
      recommendedAction = 'Activar contacto preventivo personalizado 72h antes del vencimiento con recordatorio y enlace/instrucción de pago.';
      expectedImpactSummary = 'Estabiliza cumplimiento antes del vencimiento y previene generación de mora.';
    }

    const followUpDays = twin.priority === 'CRITICA' ? 1 : twin.priority === 'ALTA' ? 2 : 5;
    const suggestedFollowUpDate = addCalendarDays(asOfDateIso, followUpDays);

    const evidenceUsed = [
      `DPD actual: ${twin.dpdCurrent}d · Deterioro: ${twin.deteriorationScore}/100`,
      `Puntualidad: ${twin.patterns.punctualityRatePct}% · Cambio conductual: ${twin.patterns.behavioralShiftDeltaDays >= 0 ? '+' : ''}${twin.patterns.behavioralShiftDeltaDays}d`,
      `Saldo capital: ${twin.currency} ${twin.currentPrincipalBalance.toFixed(2)} · Vencido: ${twin.currency} ${twin.totalOverdue.toFixed(2)}`,
      `Gestiones previas registradas: ${recentActions.length} · Alertas Centinela: ${loanAlerts.length}`,
    ];

    signals.push({
      id: `planb_${twin.loanId}`,
      loanId: twin.loanId,
      loanNumber: twin.loanNumber,
      customerId: twin.customerId,
      customerName: twin.customerName,
      currency: twin.currency,
      situationDetected: twin.signalsDetected[0] || twin.recentvsHistoricalSummary,
      evidenceUsed,
      priority: twin.priority,
      detectedRisk,
      recommendedAction,
      suggestedInterventionType,
      suggestedParams,
      suggestedAssigneeId: acc?.assignedCollectorId ?? null,
      suggestedAssigneeName: acc?.assignedCollectorName || 'Coordinación de Cobranza / Analista',
      suggestedFollowUpDate,
      expectedImpactSummary,
      deteriorationScore: twin.deteriorationScore,
      confidencePct: twin.explainability.confidencePct,
      explainability: {
        ...twin.explainability,
        whatWasDetected: detectedRisk,
        whyRecommended: recommendedAction,
      },
    });
  }

  const priorityRank: Record<AlteraPriority, number> = {
    CRITICA: 4,
    ALTA: 3,
    MEDIA: 2,
    BAJA: 1,
  };

  return signals.sort(
    (a, b) =>
      priorityRank[b.priority] - priorityRank[a.priority] ||
      b.deteriorationScore - a.deteriorationScore
  );
}

export function buildAlteraPortfolioSummary(params: {
  twins: AlteraCreditDigitalTwin[];
  dnas: AlteraFinancialDna[];
  preventiveSignals: AlteraPreventiveSignal[];
  recommendations: AlteraRecommendationRecord[];
  savedScenarios: AlteraSavedScenarioRecord[];
  outcomes: Array<{ commitmentFulfilled: boolean; effectivenessScore: number }>;
  asOfDateIso?: string;
}): AlteraPortfolioIntelligenceSummary {
  const {
    twins,
    dnas,
    preventiveSignals,
    recommendations,
    savedScenarios,
    outcomes,
    asOfDateIso = getSantoDomingoTodayIso(),
  } = params;

  const activeTwins = twins.filter(
    (t) => t.loanStatus !== 'PAGADO' && t.loanStatus !== 'CANCELADO' && t.currentPrincipalBalance > 0
  );

  const activeExposureDop = fromCents(
    activeTwins.filter((t) => t.currency === 'DOP').reduce((s, t) => s + toCents(t.currentPrincipalBalance), 0)
  );
  const activeExposureUsd = fromCents(
    activeTwins.filter((t) => t.currency === 'USD').reduce((s, t) => s + toCents(t.currentPrincipalBalance), 0)
  );

  const averageDeteriorationScore =
    activeTwins.length > 0
      ? round1(activeTwins.reduce((s, t) => s + t.deteriorationScore, 0) / activeTwins.length)
      : 0;
  const averageRecoveryProbabilityPct =
    activeTwins.length > 0
      ? round1(activeTwins.reduce((s, t) => s + t.recoveryProbabilityPct, 0) / activeTwins.length)
      : 0;

  const criticalSignals = preventiveSignals.filter((s) => s.priority === 'CRITICA' || s.priority === 'ALTA');
  const pendingRecs = recommendations.filter((r) =>
    ['GENERADA', 'PENDIENTE_REVISION'].includes(r.status)
  );
  const approvedOrExecuting = recommendations.filter((r) =>
    ['APROBADA', 'EN_EJECUCION'].includes(r.status)
  );
  const successfulInterventionsCount =
    outcomes.filter((o) => o.commitmentFulfilled || o.effectivenessScore >= 65).length +
    recommendations.filter((r) => r.status === 'EJECUTADA' || r.status === 'CERRADA').length;

  const healthyCount = activeTwins.filter((t) => t.deteriorationScore < 32).length;
  const earlyCount = activeTwins.filter((t) => t.deteriorationScore >= 32 && t.deteriorationScore < 55).length;
  const highCount = activeTwins.filter((t) => t.deteriorationScore >= 55 && t.deteriorationScore < 78).length;
  const criticalCount = activeTwins.filter((t) => t.deteriorationScore >= 78).length;

  const stages = Array.from(new Set(activeTwins.map((t) => t.collectionStage)));
  const stageExposureSummary = stages.map((stage) => {
    const grp = activeTwins.filter((t) => t.collectionStage === stage);
    return {
      stage,
      loansCount: grp.length,
      exposureDop: fromCents(
        grp.filter((t) => t.currency === 'DOP').reduce((s, t) => s + toCents(t.currentPrincipalBalance), 0)
      ),
      exposureUsd: fromCents(
        grp.filter((t) => t.currency === 'USD').reduce((s, t) => s + toCents(t.currentPrincipalBalance), 0)
      ),
      avgDeteriorationScore:
        grp.length > 0 ? round1(grp.reduce((s, t) => s + t.deteriorationScore, 0) / grp.length) : 0,
    };
  });

  const dataLimitations: string[] = [];
  if (activeTwins.length === 0) {
    dataLimitations.push('No existen préstamos activos desembolsados para modelado en esta organización.');
  }
  const missingIncomeCount = dnas.filter((d) => !d.incomeDataAvailable).length;
  if (missingIncomeCount > 0) {
    dataLimitations.push(
      `${missingIncomeCount} de ${dnas.length} clientes no registran ingresos verificados en solicitudes/evaluaciones recientes.`
    );
  }

  return {
    asOfDateIso,
    totalAnalyzedLoans: twins.length,
    totalAnalyzedCustomers: dnas.length,
    activeExposureDop,
    activeExposureUsd,
    preventiveSignalsCount: preventiveSignals.length,
    criticalAlertsCount: criticalSignals.length,
    pendingRecommendationsCount: pendingRecs.length,
    approvedOrExecutingCount: approvedOrExecuting.length,
    successfulInterventionsCount,
    savedScenariosCount: savedScenarios.length,
    averageDeteriorationScore,
    averageRecoveryProbabilityPct,
    deteriorationDistribution: [
      { band: 'Saludable (0-31)', count: healthyCount, color: '#00D1FF' },
      { band: 'Preventivo (32-54)', count: earlyCount, color: '#38BDF8' },
      { band: 'Riesgo Alto (55-77)', count: highCount, color: '#F59E0B' },
      { band: 'Crítico (78-100)', count: criticalCount, color: '#EF4444' },
    ],
    stageExposureSummary,
    dataLimitations,
  };
}
