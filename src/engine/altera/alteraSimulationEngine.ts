import type {
  AlteraConfigRecord,
  AlteraCreditDigitalTwin,
  AlteraExplainabilityBlock,
  AlteraFinancialDna,
  AlteraInterventionType,
  AlteraOutcomeRecord,
  AlteraPortfolioIntelligenceSummary,
  AlteraPreventiveSignal,
  AlteraQueryEvidenceItem,
  AlteraQueryResponse,
  AlteraRecommendationRecord,
  AlteraUniverseComparison,
  AlteraUniverseOutcome,
  AlteraUniverseParameters,
  AlteraUniverseProjectionPoint,
} from '../../types/altera';
import type {
  CollectionPolicyVersionRecord,
  CreditPolicyRecord,
  LoanInstallmentRecord,
  LoanRecord,
  PaymentPromiseRecord,
  PaymentRecord,
} from '../../types/axycore';
import {
  DEFAULT_COLLECTION_POLICY_V1,
  fromCents,
  getSantoDomingoTodayIso,
  toCents,
} from '../collections/delinquencyEngine';
import { buildDefaultAlteraConfig } from './alteraTwinAndDnaEngine';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addDaysIso(baseIso: string, days: number): string {
  const clean = (baseIso || getSantoDomingoTodayIso()).slice(0, 10);
  const dt = new Date(`${clean}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return clean;
  dt.setUTCDate(dt.getUTCDate() + Math.round(days));
  return dt.toISOString().slice(0, 10);
}

function addMonthsIso(baseIso: string, months: number): string {
  const clean = (baseIso || getSantoDomingoTodayIso()).slice(0, 10);
  const dt = new Date(`${clean}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return clean;
  dt.setUTCMonth(dt.getUTCMonth() + Math.round(months));
  return dt.toISOString().slice(0, 10);
}

const INTERVENTION_LABELS: Record<AlteraInterventionType, string> = {
  ABONO_EXTRAORDINARIO: 'Abono Extraordinario a Capital',
  CAMBIO_FECHA_PAGO: 'Cambio de Fecha de Pago',
  REESTRUCTURACION_PLAZO: 'Reestructuración de Plazo',
  REDUCCION_TEMPORAL_CUOTA: 'Reducción Temporal de Cuota',
  ESTRATEGIA_COBRANZA_PREVENTIVA: 'Estrategia Preventiva de Cobranza',
  PAGO_PARCIAL_CONTROLADO: 'Pago Parcial Controlado',
};

function computeScheduleProjection(params: {
  principal: number;
  monthlyRatePct: number;
  periods: number;
  amortizationMethod: LoanRecord['amortizationMethod'];
  frequency: LoanRecord['frequency'];
  targetFixedInstallment?: number;
  temporaryReductionPct?: number;
  temporaryReductionMonths?: number;
  baseRecoveryPct: number;
  baseRiskScore: number;
  riskImprovementBonus: number;
}): {
  installmentAmount: number;
  totalPayable: number;
  totalInterest: number;
  actualPeriods: number;
  projectionSeries: AlteraUniverseProjectionPoint[];
  balanceAtHorizon: number;
} {
  const principalCents = Math.max(0, toCents(params.principal));
  const periods = Math.max(1, Math.round(params.periods));
  const freqDivisor =
    params.frequency === 'QUINCENAL' ? 2 : params.frequency === 'SEMANAL' ? 4 : 1;
  const periodRate = Math.max(0, params.monthlyRatePct / 100 / freqDivisor);

  if (principalCents === 0) {
    return {
      installmentAmount: 0,
      totalPayable: 0,
      totalInterest: 0,
      actualPeriods: 0,
      projectionSeries: [
        {
          periodIndex: 0,
          label: 'Hoy',
          remainingBalance: 0,
          cumulativePaid: 0,
          expectedRecoveryPct: 100,
          estimatedRiskScore: 0,
          installmentAmount: 0,
          principalPaid: 0,
          interestPaid: 0,
        },
      ],
      balanceAtHorizon: 0,
    };
  }

  let stdInstallmentCents = 0;
  if (params.targetFixedInstallment && params.targetFixedInstallment > 0) {
    stdInstallmentCents = toCents(params.targetFixedInstallment);
  } else if (params.amortizationMethod === 'SALDO_INSOLUTO') {
    if (periodRate === 0) {
      stdInstallmentCents = Math.round(principalCents / periods);
    } else {
      const f = Math.pow(1 + periodRate, -periods);
      stdInstallmentCents = Math.round((principalCents * periodRate) / (1 - f));
    }
  } else {
    const flatTotalInterestCents = Math.round(principalCents * periodRate * periods);
    stdInstallmentCents = Math.round((principalCents + flatTotalInterestCents) / periods);
  }

  const reducedFactor =
    params.temporaryReductionPct && params.temporaryReductionPct > 0
      ? 1 - clamp(params.temporaryReductionPct, 5, 65) / 100
      : 1;
  const reducedPeriods = Math.min(
    periods - 1,
    Math.max(0, Math.round((params.temporaryReductionMonths ?? 0) * freqDivisor))
  );

  let remCents = principalCents;
  let totalIntCents = 0;
  let totalPaidCents = 0;
  let firstInstallment = 0;
  let actualPeriods = 0;
  const series: AlteraUniverseProjectionPoint[] = [
    {
      periodIndex: 0,
      label: 'Actual',
      remainingBalance: fromCents(remCents),
      cumulativePaid: 0,
      expectedRecoveryPct: round1(params.baseRecoveryPct),
      estimatedRiskScore: Math.round(params.baseRiskScore),
      installmentAmount: 0,
      principalPaid: 0,
      interestPaid: 0,
    },
  ];

  const horizonPeriods = Math.min(Math.max(periods, 12), 24);

  for (let i = 1; i <= periods; i++) {
    if (remCents <= 0) break;
    actualPeriods = i;
    const interestCents =
      params.amortizationMethod === 'SALDO_INSOLUTO'
        ? Math.round(remCents * periodRate)
        : Math.round(principalCents * periodRate);

    let targetPmt = stdInstallmentCents;
    if (i <= reducedPeriods) {
      targetPmt = Math.max(interestCents, Math.round(stdInstallmentCents * reducedFactor));
    }

    let princCents = 0;
    if (i === periods) {
      princCents = remCents;
    } else {
      princCents = Math.min(remCents, Math.max(0, targetPmt - interestCents));
    }
    const totalPeriodCents = princCents + interestCents;
    if (i === 1) firstInstallment = fromCents(totalPeriodCents);

    remCents = Math.max(0, remCents - princCents);
    totalIntCents += interestCents;
    totalPaidCents += totalPeriodCents;

    if (i <= horizonPeriods) {
      const progressRatio = i / periods;
      const riskAfter = clamp(
        params.baseRiskScore - params.riskImprovementBonus * Math.min(1, i / 4),
        4,
        98
      );
      const recAfter = clamp(
        params.baseRecoveryPct + params.riskImprovementBonus * 0.45 * progressRatio,
        10,
        99.5
      );
      series.push({
        periodIndex: i,
        label: `P${i}`,
        remainingBalance: fromCents(remCents),
        cumulativePaid: fromCents(totalPaidCents),
        expectedRecoveryPct: round1(recAfter),
        estimatedRiskScore: Math.round(riskAfter),
        installmentAmount: fromCents(totalPeriodCents),
        principalPaid: fromCents(princCents),
        interestPaid: fromCents(interestCents),
      });
    }
  }

  const horizonPoint = series[Math.min(series.length - 1, Math.min(6, actualPeriods))];

  return {
    installmentAmount: firstInstallment || fromCents(stdInstallmentCents),
    totalPayable: fromCents(totalPaidCents),
    totalInterest: fromCents(totalIntCents),
    actualPeriods,
    projectionSeries: series,
    balanceAtHorizon: horizonPoint ? horizonPoint.remainingBalance : fromCents(remCents),
  };
}

export function simulateAlternativeUniverses(params: {
  loan: LoanRecord;
  twin: AlteraCreditDigitalTwin;
  parameters: AlteraUniverseParameters;
  creditPolicy?: CreditPolicyRecord;
  collectionPolicy?: CollectionPolicyVersionRecord;
  alteraConfig?: AlteraConfigRecord;
  asOfDateIso?: string;
}): AlteraUniverseComparison {
  const {
    loan,
    twin,
    parameters,
    creditPolicy,
    alteraConfig = buildDefaultAlteraConfig(loan.organizationId),
    asOfDateIso = getSantoDomingoTodayIso(),
  } = params;

  const basePrincipal = Math.max(0, twin.currentPrincipalBalance);
  const currentRatePct = twin.contractualRateMonthlyPct || 4;
  const remainingPeriods = Math.max(1, twin.remainingTermInstallments || loan.termMonths || 1);

  // 1. Escenario ACTUAL (sin intervención)
  const actualProj = computeScheduleProjection({
    principal: basePrincipal,
    monthlyRatePct: currentRatePct,
    periods: remainingPeriods,
    amortizationMethod: loan.amortizationMethod,
    frequency: loan.frequency,
    baseRecoveryPct: twin.recoveryProbabilityPct,
    baseRiskScore: twin.deteriorationScore,
    riskImprovementBonus: twin.dpdCurrent > 0 ? -6 : 2,
  });

  const freqDivisor = loan.frequency === 'QUINCENAL' ? 2 : loan.frequency === 'SEMANAL' ? 4 : 1;
  const baseMonthsToPayoff = round1(remainingPeriods / freqDivisor);
  const baseNextDueIso = twin.nextDueDate || loan.maturityDate || asOfDateIso;
  const basePayoffIso = addMonthsIso(asOfDateIso, baseMonthsToPayoff);

  const universeActual: AlteraUniverseOutcome = {
    universeCode: 'ACTUAL_SIN_INTERVENCION',
    title: 'Escenario Actual',
    subtitle: 'Continuidad sin intervención bajo condiciones vigentes',
    interventionTypeLabel: 'Sin modificación operativa',
    conditionsConsidered: [
      `Saldo capital vigente: ${loan.currency} ${basePrincipal.toFixed(2)}`,
      `Tasa mensual contractual: ${currentRatePct}% (${loan.amortizationMethod === 'SALDO_INSOLUTO' ? 'Saldo Insoluto' : 'Interés Fijo'})`,
      `Cuotas restantes estimadas: ${remainingPeriods} (${loan.frequency})`,
    ],
    policyCompliant: true,
    policyViolations: [],
    projectedInstallmentAmount: actualProj.installmentAmount,
    projectedTotalPayable: actualProj.totalPayable,
    projectedTotalInterest: actualProj.totalInterest,
    projectedBalanceAtHorizon: actualProj.balanceAtHorizon,
    balanceDeltaVsCurrent: 0,
    installmentDeltaVsCurrent: 0,
    interestDeltaVsCurrent: 0,
    totalPayableDeltaVsCurrent: 0,
    monthsDeltaVsCurrent: 0,
    projectedNextDueDateIso: twin.nextDueDate,
    projectedPayoffDateIso: basePayoffIso,
    projectedRecoveryPct: twin.recoveryProbabilityPct,
    recoveryDeltaVsCurrentPct: 0,
    estimatedDelinquencyRiskPct: round1(twin.deteriorationScore),
    riskReductionPct: 0,
    projectedMonthsToPayoff: baseMonthsToPayoff,
    benefits: [
      'Conserva los términos contractuales originales sin trámite adicional.',
      'Cero sacrificio de tasa ni extensión de madurez.',
    ],
    disadvantages:
      twin.deteriorationScore >= 35
        ? [
            `Mantiene riesgo de deterioro estimado en ${twin.deteriorationScore}/100.`,
            twin.dpdCurrent > 0
              ? `Continuará acumulando mora (${twin.dpdCurrent} DPD actuales) si no hay pago inmediato.`
              : 'Persisten señales tempranas de fricción de pago sin mitigación.',
          ]
        : ['Exposición marginal sin ajuste preventivo frente a eventualidades del cliente.'],
    projectionSeries: actualProj.projectionSeries,
    isAlteraRecommended: false,
  };

  // 2. Escenario PREVENTIVO (intervención anticipada respetando contrato)
  const preventiveChannel = parameters.preventiveContactChannel || (twin.dpdCurrent >= 15 ? 'LLAMADA' : 'WHATSAPP');
  const preventiveRiskBoost = twin.dpdCurrent >= 16 ? 11 : 16;
  const preventiveRecoveryBoost = twin.dpdCurrent >= 16 ? 6.5 : 8.5;
  const preventiveRecoveryPct = round1(clamp(twin.recoveryProbabilityPct + preventiveRecoveryBoost, 15, 99));
  const preventiveRiskPct = round1(clamp(twin.deteriorationScore - preventiveRiskBoost, 4, 95));

  const preventiveProj = computeScheduleProjection({
    principal: basePrincipal,
    monthlyRatePct: currentRatePct,
    periods: remainingPeriods,
    amortizationMethod: loan.amortizationMethod,
    frequency: loan.frequency,
    baseRecoveryPct: preventiveRecoveryPct,
    baseRiskScore: preventiveRiskPct,
    riskImprovementBonus: preventiveRiskBoost,
  });

  const universePreventivo: AlteraUniverseOutcome = {
    universeCode: 'PREVENTIVO_ANTICIPADO',
    title: 'Escenario Preventivo',
    subtitle: `Intervención temprana vía ${preventiveChannel} sin novación contractual`,
    interventionTypeLabel: 'Contención Preventiva Anticipada',
    conditionsConsidered: [
      `Contacto preventivo programado (${preventiveChannel}) dentro de horario permitido Ley 172-13`,
      'Recordatorio de pago anticipado + seguimiento a 48h con responsable asignado',
      'Mantiene capital, tasa y calendario contractual intactos',
    ],
    policyCompliant: true,
    policyViolations: [],
    projectedInstallmentAmount: preventiveProj.installmentAmount,
    projectedTotalPayable: preventiveProj.totalPayable,
    projectedTotalInterest: preventiveProj.totalInterest,
    projectedBalanceAtHorizon: preventiveProj.balanceAtHorizon,
    balanceDeltaVsCurrent: round2(preventiveProj.balanceAtHorizon - actualProj.balanceAtHorizon),
    installmentDeltaVsCurrent: round2(preventiveProj.installmentAmount - actualProj.installmentAmount),
    interestDeltaVsCurrent: round2(preventiveProj.totalInterest - actualProj.totalInterest),
    totalPayableDeltaVsCurrent: round2(preventiveProj.totalPayable - actualProj.totalPayable),
    monthsDeltaVsCurrent: 0,
    projectedNextDueDateIso: twin.nextDueDate,
    projectedPayoffDateIso: basePayoffIso,
    projectedRecoveryPct: preventiveRecoveryPct,
    recoveryDeltaVsCurrentPct: round1(preventiveRecoveryPct - twin.recoveryProbabilityPct),
    estimatedDelinquencyRiskPct: preventiveRiskPct,
    riskReductionPct: round1(twin.deteriorationScore - preventiveRiskPct),
    projectedMonthsToPayoff: universeActual.projectedMonthsToPayoff,
    benefits: [
      `Reduce riesgo estimado de deterioro en ${round1(twin.deteriorationScore - preventiveRiskPct)} puntos sin modificar contrato.`,
      'Despliegue inmediato operativo en Cobranza / Contact Center.',
    ],
    disadvantages:
      twin.dpdCurrent >= 25
        ? ['Si el cliente sufre iliquidez estructural, el contacto preventivo por sí solo puede ser insuficiente.']
        : ['Requiere disciplina operativa del gestor asignado para cumplir SLA de seguimiento.'],
    projectionSeries: preventiveProj.projectionSeries,
    isAlteraRecommended: false,
  };

  // 3. Escenario ALTERNATIVO (parámetros individuales o combinados dentro de política)
  const policyViolations: string[] = [];
  let effectivePrincipal = basePrincipal;
  let effectivePeriods = remainingPeriods;
  let effectiveRatePct = currentRatePct;
  let targetFixedInstallment: number | undefined = undefined;
  let tempRedPct = 0;
  let tempRedMonths = 0;
  let altRecoveryDelta = 0;
  let altRiskDelta = 0;
  let projectedNextDueDateIso: string | null = twin.nextDueDate;
  const altConditions: string[] = [];
  const altBenefits: string[] = [];
  const altDisadvantages: string[] = [];

  const productCfg = creditPolicy?.products?.[loan.productCode];
  const minProductRate = creditPolicy
    ? Math.min(
        ...creditPolicy.riskBands
          .map((b) => b.monthlyRate)
          .filter((r): r is number => typeof r === 'number' && r > 0)
      )
    : 2;

  const isCombined = Boolean(parameters.combineVariables);
  const applyAbono =
    parameters.interventionType === 'ABONO_EXTRAORDINARIO' ||
    (isCombined && (parameters.extraordinaryPaymentAmount ?? 0) > 0);
  const applyDueDateShift =
    parameters.interventionType === 'CAMBIO_FECHA_PAGO' ||
    (isCombined && (parameters.dueDateShiftDays ?? 0) > 0);
  const applyRestructure =
    parameters.interventionType === 'REESTRUCTURACION_PLAZO' ||
    (isCombined &&
      ((parameters.restructuredTermMonths ?? 0) > 0 ||
        (parameters.restructuredMonthlyRatePct ?? 0) > 0));
  const applyTempReduction =
    parameters.interventionType === 'REDUCCION_TEMPORAL_CUOTA' ||
    (isCombined && (parameters.temporaryReductionPct ?? 0) > 0);
  const applyPartial =
    !isCombined && parameters.interventionType === 'PAGO_PARCIAL_CONTROLADO';

  if (applyAbono) {
    const rawAbono =
      parameters.extraordinaryPaymentAmount ??
      (parameters.interventionType === 'ABONO_EXTRAORDINARIO' ? round2(basePrincipal * 0.2) : 0);
    const abono = Math.max(0, Math.min(basePrincipal, rawAbono));
    effectivePrincipal = Math.max(0, round2(effectivePrincipal - abono));
    const applyMode = parameters.extraordinaryApplyMode || 'REDUCIR_CUOTA';
    if (applyMode === 'REDUCIR_PLAZO' && effectivePrincipal > 0 && !applyRestructure) {
      targetFixedInstallment = actualProj.installmentAmount;
    }
    altConditions.push(
      `Abono extraordinario a capital de ${loan.currency} ${abono.toFixed(2)} (${
        applyMode === 'REDUCIR_PLAZO' ? 'manteniendo cuota para acortar plazo' : 'recalculando cuota más baja'
      })`
    );
    altConditions.push(`Nuevo saldo amortizable simulado: ${loan.currency} ${effectivePrincipal.toFixed(2)}`);
    altRecoveryDelta += clamp((abono / Math.max(1, basePrincipal)) * 28, 4, 24);
    altRiskDelta += clamp((abono / Math.max(1, basePrincipal)) * 34, 5, 28);
    altBenefits.push(`Reduce inmediatamente el capital expuesto en ${loan.currency} ${abono.toFixed(2)}.`);
    altBenefits.push(
      applyMode === 'REDUCIR_PLAZO'
        ? 'Acelera la liquidación del préstamo reduciendo cuotas futuras e intereses acumulados.'
        : 'Reduce el monto de la cuota periódica facilitando el cumplimiento mensual.'
    );
    altDisadvantages.push('Requiere disponibilidad de liquidez inmediata del cliente para ejecutar el abono.');
    if (abono <= 0) policyViolations.push('El monto de abono extraordinario debe ser mayor a cero.');
  }

  if (applyDueDateShift) {
    const shiftDays = clamp(parameters.dueDateShiftDays ?? 7, 1, 45);
    projectedNextDueDateIso = addDaysIso(baseNextDueIso, shiftDays);
    altConditions.push(
      `Desplazamiento de fecha de cobro en +${shiftDays} días (nuevo próximo vencimiento est.: ${projectedNextDueDateIso})`
    );
    if (shiftDays > alteraConfig.maxDueDateShiftDays) {
      policyViolations.push(
        `El desplazamiento de ${shiftDays} días excede el límite configurado en ALTERA (${alteraConfig.maxDueDateShiftDays} días).`
      );
    }
    altRecoveryDelta += 8.5;
    altRiskDelta += 14;
    altBenefits.push('Elimina atrasos friccionales recurrentes causados por desfase entre quincena/cobro y vencimiento.');
    altBenefits.push('Preserva íntegramente el capital y rendimiento de intereses.');
    altDisadvantages.push('Ligero corrimiento del flujo de caja institucional dentro del mes corriente.');
  }

  if (applyRestructure) {
    const targetTermMonths = Math.max(
      2,
      Math.round(
        parameters.restructuredTermMonths ??
          Math.min(36, Math.ceil(universeActual.projectedMonthsToPayoff + 4))
      )
    );
    effectivePeriods = targetTermMonths * freqDivisor;
    if (parameters.restructuredMonthlyRatePct && parameters.restructuredMonthlyRatePct > 0) {
      effectiveRatePct = parameters.restructuredMonthlyRatePct;
    }
    const extensionMonths = Math.max(0, targetTermMonths - Math.ceil(universeActual.projectedMonthsToPayoff));
    altConditions.push(
      `Reestructuración a ${targetTermMonths} meses (${effectivePeriods} cuotas ${loan.frequency.toLowerCase()}) · Tasa ${effectiveRatePct}%`
    );
    if (extensionMonths > alteraConfig.maxRestructureExtensionMonths) {
      policyViolations.push(
        `La extensión de +${extensionMonths} meses supera el máximo institucional de ALTERA (${alteraConfig.maxRestructureExtensionMonths} meses).`
      );
    }
    if (productCfg && targetTermMonths > productCfg.maxTermMonths) {
      policyViolations.push(
        `El plazo total (${targetTermMonths}m) excede el límite del producto ${loan.productCode} (${productCfg.maxTermMonths}m).`
      );
    }
    if (effectiveRatePct < minProductRate) {
      policyViolations.push(
        `La tasa propuesta (${effectiveRatePct}%) está por debajo del piso vigente de bandas de riesgo (${minProductRate}%).`
      );
    }
    altRecoveryDelta += twin.dpdCurrent >= 15 ? 16 : 9;
    altRiskDelta += twin.dpdCurrent >= 15 ? 24 : 14;
    altBenefits.push('Disminuye la cuota periódica facilitando la capacidad de pago real del cliente.');
    altBenefits.push('Evita pérdida total o pase a cobranza judicial en créditos con estrés severo.');
    altDisadvantages.push('Incrementa el interés total acumulado por mayor duración del saldo en el tiempo.');
  }

  if (applyTempReduction) {
    tempRedPct = clamp(parameters.temporaryReductionPct ?? 25, 5, 70);
    tempRedMonths = clamp(parameters.temporaryReductionMonths ?? 2, 1, 6);
    altConditions.push(`Reducción temporal de cuota en ${tempRedPct}% durante ${tempRedMonths} mes(es)`);
    altConditions.push('Cuota completa se retoma automáticamente tras la ventana de alivio');
    if (tempRedPct > alteraConfig.maxTemporaryReductionPct) {
      policyViolations.push(
        `La reducción del ${tempRedPct}% excede el máximo permitido (${alteraConfig.maxTemporaryReductionPct}%).`
      );
    }
    if (tempRedMonths > alteraConfig.maxTemporaryReductionMonths) {
      policyViolations.push(
        `El período de alivio (${tempRedMonths}m) excede el límite (${alteraConfig.maxTemporaryReductionMonths}m).`
      );
    }
    altRecoveryDelta += 11.5;
    altRiskDelta += 17;
    altBenefits.push('Otorga oxígeno financiero temporal sin reescribir indefinidamente la madurez del préstamo.');
    altBenefits.push('Mantiene la relación crediticia activa cuando el problema es transitorio.');
    altDisadvantages.push('Genera un ligero repunte de saldo amortizable después del período de alivio.');
  }

  if (applyPartial) {
    const partialAmt = Math.max(
      0,
      Math.min(
        basePrincipal,
        parameters.partialPaymentAmount ??
          round2(twin.totalOverdue > 0 ? twin.totalOverdue * 0.6 : twin.nextDueAmount * 0.7)
      )
    );
    effectivePrincipal = Math.max(0, round2(effectivePrincipal - partialAmt * 0.65));
    altConditions.push(`Recepción de pago parcial controlado de ${loan.currency} ${partialAmt.toFixed(2)}`);
    altConditions.push('Aplicación estricta según orden de imputación de la política de cobranza');
    if (partialAmt <= 0) policyViolations.push('El monto de pago parcial debe ser mayor a cero.');
    altRecoveryDelta += 8;
    altRiskDelta += 11;
    altBenefits.push('Captura liquidez inmediata disponible evitando ruptura total del compromiso.');
    altBenefits.push('Demuestra voluntad de pago mientras se programa el remanente.');
    altDisadvantages.push('Mantiene saldo vencido remanente hasta completar la cuota exigible.');
  }

  if (!applyAbono && !applyDueDateShift && !applyRestructure && !applyTempReduction && !applyPartial) {
    altConditions.push(`Plan de contacto multicanal (${preventiveChannel}) + acuerdo de cumplimiento`);
    altRecoveryDelta += 10;
    altRiskDelta += 16;
    altBenefits.push('Cero alteración de tasa, capital o plazo original.');
    altDisadvantages.push('Menor capacidad de alivio si existe choque severo de ingresos.');
  }

  const altRecoveryPct = round1(clamp(twin.recoveryProbabilityPct + clamp(altRecoveryDelta, 0, 28), 15, 99.2));
  const altRiskPct = round1(clamp(twin.deteriorationScore - clamp(altRiskDelta, 0, 32), 4, 96));

  const altProj = computeScheduleProjection({
    principal: effectivePrincipal,
    monthlyRatePct: effectiveRatePct,
    periods: effectivePeriods,
    amortizationMethod: loan.amortizationMethod,
    frequency: loan.frequency,
    targetFixedInstallment,
    temporaryReductionPct: tempRedPct,
    temporaryReductionMonths: tempRedMonths,
    baseRecoveryPct: altRecoveryPct,
    baseRiskScore: altRiskPct,
    riskImprovementBonus: clamp(altRiskDelta, 4, 30),
  });

  const altMonthsToPayoff = round1(altProj.actualPeriods / freqDivisor);
  const altPayoffIso = addDaysIso(
    addMonthsIso(asOfDateIso, altMonthsToPayoff),
    applyDueDateShift ? clamp(parameters.dueDateShiftDays ?? 7, 1, 45) : 0
  );

  const universeAlternativo: AlteraUniverseOutcome = {
    universeCode: 'ALTERNATIVO_CONDICIONES',
    title: 'Escenario Alternativo',
    subtitle: isCombined
      ? `Simulación Combinada (${INTERVENTION_LABELS[parameters.interventionType]})`
      : INTERVENTION_LABELS[parameters.interventionType],
    interventionTypeLabel: isCombined
      ? 'Simulación Multi-Variable Combinada'
      : INTERVENTION_LABELS[parameters.interventionType],
    conditionsConsidered: altConditions,
    policyCompliant: policyViolations.length === 0,
    policyViolations,
    projectedInstallmentAmount: altProj.installmentAmount,
    projectedTotalPayable: altProj.totalPayable,
    projectedTotalInterest: altProj.totalInterest,
    projectedBalanceAtHorizon: altProj.balanceAtHorizon,
    balanceDeltaVsCurrent: round2(altProj.balanceAtHorizon - actualProj.balanceAtHorizon),
    installmentDeltaVsCurrent: round2(altProj.installmentAmount - actualProj.installmentAmount),
    interestDeltaVsCurrent: round2(altProj.totalInterest - actualProj.totalInterest),
    totalPayableDeltaVsCurrent: round2(altProj.totalPayable - actualProj.totalPayable),
    monthsDeltaVsCurrent: round1(altMonthsToPayoff - baseMonthsToPayoff),
    projectedNextDueDateIso,
    projectedPayoffDateIso: altPayoffIso,
    projectedRecoveryPct: altRecoveryPct,
    recoveryDeltaVsCurrentPct: round1(altRecoveryPct - twin.recoveryProbabilityPct),
    estimatedDelinquencyRiskPct: altRiskPct,
    riskReductionPct: round1(twin.deteriorationScore - altRiskPct),
    projectedMonthsToPayoff: altMonthsToPayoff,
    benefits: altBenefits,
    disadvantages: altDisadvantages,
    projectionSeries: altProj.projectionSeries,
    isAlteraRecommended: false,
  };

  // Pick optimal compliant universe deterministically
  let recommendedUniverseCode: AlteraUniverseOutcome['universeCode'] = 'PREVENTIVO_ANTICIPADO';
  let alteraRecommendationHeadline = '';
  let alteraRecommendationDetail = '';

  if (twin.deteriorationScore < 25 && twin.dpdCurrent === 0 && parameters.interventionType !== 'ABONO_EXTRAORDINARIO') {
    recommendedUniverseCode = 'ACTUAL_SIN_INTERVENCION';
    alteraRecommendationHeadline = 'Mantener Escenario Actual bajo monitoreo adaptativo';
    alteraRecommendationDetail =
      'El crédito mantiene puntualidad saludable y bajo riesgo. No se justifica modificar condiciones ni consumir capacidad de reestructuración.';
  } else if (
    universeAlternativo.policyCompliant &&
    (universeAlternativo.projectedRecoveryPct >= universePreventivo.projectedRecoveryPct + 2 ||
      parameters.interventionType === 'ABONO_EXTRAORDINARIO' ||
      twin.dpdCurrent >= 15)
  ) {
    recommendedUniverseCode = 'ALTERNATIVO_CONDICIONES';
    alteraRecommendationHeadline = `Recomendado: Escenario Alternativo (${INTERVENTION_LABELS[parameters.interventionType]})`;
    alteraRecommendationDetail = `Cumple las políticas vigentes, mejora la probabilidad de recuperación a ${universeAlternativo.projectedRecoveryPct}% (+${universeAlternativo.recoveryDeltaVsCurrentPct}%) y reduce el riesgo estimado en ${universeAlternativo.riskReductionPct} pts.`;
  } else {
    recommendedUniverseCode = 'PREVENTIVO_ANTICIPADO';
    alteraRecommendationHeadline = 'Recomendado: Escenario Preventivo Anticipado';
    alteraRecommendationDetail =
      universeAlternativo.policyCompliant
        ? `La intervención preventiva logra ${universePreventivo.projectedRecoveryPct}% de recuperación esperada preservando intactos capital, tasa y madurez.`
        : `El escenario alternativo incumple límites de política (${policyViolations[0]}), por lo que ALTERA prioriza el Escenario Preventivo.`;
  }

  universeActual.isAlteraRecommended = recommendedUniverseCode === 'ACTUAL_SIN_INTERVENCION';
  universePreventivo.isAlteraRecommended = recommendedUniverseCode === 'PREVENTIVO_ANTICIPADO';
  universeAlternativo.isAlteraRecommended = recommendedUniverseCode === 'ALTERNATIVO_CONDICIONES';

  const explainability: AlteraExplainabilityBlock = {
    whatWasDetected: `Comparativa de 3 universos para ${loan.loanNumber} (${loan.currency} ${basePrincipal.toFixed(2)} vigentes, ${twin.dpdCurrent} DPD).`,
    dataUsed: [
      `Gemelo Digital ${loan.loanNumber} (deterioro ${twin.deteriorationScore}/100)`,
      `Tasa vigente ${currentRatePct}% · ${remainingPeriods} cuotas restantes`,
      `Límites de política crediticia y parámetros ALTERA vigentes`,
    ],
    whyRiskOrOpportunityExists: alteraRecommendationDetail,
    variablesConsidered: [
      {
        label: 'Recuperación Escenario Actual',
        value: `${universeActual.projectedRecoveryPct}%`,
        weightOrImpact: 'Línea base sin acción',
      },
      {
        label: 'Recuperación Escenario Preventivo',
        value: `${universePreventivo.projectedRecoveryPct}%`,
        weightOrImpact: `+${universePreventivo.recoveryDeltaVsCurrentPct}% vs actual`,
      },
      {
        label: `Recuperación ${INTERVENTION_LABELS[parameters.interventionType]}`,
        value: `${universeAlternativo.projectedRecoveryPct}%`,
        weightOrImpact: universeAlternativo.policyCompliant ? 'Dentro de política' : 'Fuera de política',
      },
    ],
    alternativesEvaluated: [
      universeActual.title,
      universePreventivo.title,
      `${universeAlternativo.title} (${universeAlternativo.interventionTypeLabel})`,
    ],
    whyRecommended: alteraRecommendationHeadline,
    expectedOutcomeIfNoAction: `Si no se ejecuta acción alguna, se proyecta un total a pagar de ${loan.currency} ${universeActual.projectedTotalPayable.toFixed(2)} con riesgo de deterioro estimado en ${universeActual.estimatedDelinquencyRiskPct}%.`,
    confidencePct: twin.explainability.confidencePct,
    dataLimitations: [
      'Simulación 100% no destructiva; los valores proyectados no modifican el contrato ni las cuotas reales.',
      ...twin.explainability.dataLimitations,
    ],
  };

  return {
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    customerId: loan.customerId,
    customerName: twin.customerName,
    currency: loan.currency,
    asOfDateIso,
    currentBalance: basePrincipal,
    currentInstallment: actualProj.installmentAmount,
    currentMonthlyRatePct: currentRatePct,
    remainingPeriods,
    universes: [universeActual, universePreventivo, universeAlternativo],
    recommendedUniverseCode,
    alteraRecommendationHeadline,
    alteraRecommendationDetail,
    explainability,
  };
}

export function evaluateOutcomeLearning(params: {
  recommendation: AlteraRecommendationRecord;
  loan: LoanRecord;
  twin: AlteraCreditDigitalTwin;
  installments: LoanInstallmentRecord[];
  payments: PaymentRecord[];
  promises: PaymentPromiseRecord[];
  asOfDateIso?: string;
}): Omit<AlteraOutcomeRecord, 'id' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'> {
  const { recommendation, loan, twin, payments, promises, asOfDateIso = getSantoDomingoTodayIso() } = params;

  const recDate = recommendation.createdAtIso.slice(0, 10);
  const paymentsAfter = payments.filter(
    (p) =>
      p.loanId === loan.id &&
      p.status === 'APLICADO' &&
      String(p.paymentDate || '').slice(0, 10) >= recDate
  );
  const paidAfter = fromCents(paymentsAfter.reduce((s, p) => s + toCents(p.amount), 0));

  const promisesAfter = promises.filter(
    (p) =>
      p.loanId === loan.id &&
      String(p.promisedDate || '').slice(0, 10) >= recDate
  );
  const commitmentFulfilled =
    promisesAfter.some((p) => p.status === 'CUMPLIDA') ||
    (twin.dpdCurrent === 0 && paidAfter > 0) ||
    loan.status === 'PAGADO';

  const expectedDelta = Math.max(1, recommendation.expectedRecoveryDeltaPct || 8);
  const projectedRecoveryPct = round1(clamp(65 + expectedDelta, 20, 98));
  const actualRecoveryPct = round1(
    clamp(
      twin.dpdCurrent === 0
        ? Math.max(85, twin.recoveryProbabilityPct)
        : Math.max(20, twin.recoveryProbabilityPct - twin.dpdCurrent * 0.4 + (paidAfter > 0 ? 12 : 0)),
      5,
      100
    )
  );

  const projectedBalanceAfter = round2(recommendation.expectedBalanceAtHorizon || twin.currentPrincipalBalance);
  const actualBalanceAfter = round2(twin.currentPrincipalBalance);

  const projectedDaysToRegularize = recommendation.priority === 'CRITICA' ? 15 : 7;
  const actualDaysToRegularize =
    paymentsAfter.length > 0
      ? Math.max(
          1,
          Math.abs(
            Math.round(
              (new Date(paymentsAfter[0].paymentDate).getTime() - new Date(recDate).getTime()) /
                86400000
            )
          )
        )
      : Math.max(1, twin.dpdCurrent);

  const recoveryDiff = round1(actualRecoveryPct - projectedRecoveryPct);
  const effectivenessScore = Math.round(
    clamp(
      65 +
        recoveryDiff * 0.9 +
        (commitmentFulfilled ? 18 : -15) +
        (paidAfter > 0 ? 10 : -8),
      5,
      100
    )
  );

  const calibrationDeltaPct = round1(clamp(recoveryDiff * 0.35, -12, 12));
  const learningConclusion = commitmentFulfilled
    ? `Intervención efectiva: se registró recuperación aplicada de ${loan.currency} ${paidAfter.toFixed(2)} tras la recomendación (${recommendation.code}), alcanzando efectividad de ${effectivenessScore}/100.`
    : `Recuperación parcial o pendiente: diferencia de ${recoveryDiff}% respecto al escenario proyectado; requiere calibrar intensidad de seguimiento y ventana de respuesta.`;

  const recommendedWeightAdjustment =
    effectivenessScore >= 75
      ? 'Mantener pesos vigentes; la heurística determinística de prioridad demostró alta precisión.'
      : 'Incrementar peso de promesas incumplidas y umbral de deterioro temprano en +3 puntos porcentuales.';

  return {
    organizationId: recommendation.organizationId,
    recommendationId: recommendation.id,
    recommendationCode: recommendation.code,
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    customerId: loan.customerId,
    customerName: loan.applicantDisplayName,
    currency: loan.currency,
    interventionType: recommendation.interventionType,
    evaluatedAtIso: asOfDateIso,
    projectedRecoveryPct,
    actualRecoveryPct,
    projectedBalanceAfter,
    actualBalanceAfter,
    projectedDaysToRegularize,
    actualDaysToRegularize,
    commitmentFulfilled,
    effectivenessScore,
    calibrationDeltaPct,
    learningConclusion,
    recommendedWeightAdjustment,
  };
}

export function answerAlteraNaturalQuery(params: {
  queryText: string;
  portfolio: AlteraPortfolioIntelligenceSummary;
  twins: AlteraCreditDigitalTwin[];
  dnas: AlteraFinancialDna[];
  signals: AlteraPreventiveSignal[];
  loans: LoanRecord[];
  creditPolicy?: CreditPolicyRecord;
  alteraConfig?: AlteraConfigRecord;
  asOfDateIso?: string;
}): AlteraQueryResponse {
  const {
    queryText,
    portfolio,
    twins,
    dnas,
    signals,
    loans,
    creditPolicy,
    alteraConfig,
    asOfDateIso = getSantoDomingoTodayIso(),
  } = params;

  const q = queryText.trim();
  const qLower = q.toLowerCase();

  // Detect explicit loan reference or customer name inside query
  const matchedLoan = loans.find(
    (l) =>
      qLower.includes(l.loanNumber.toLowerCase()) ||
      qLower.includes(l.id.toLowerCase()) ||
      qLower.includes(l.applicantDisplayName.toLowerCase())
  );
  const targetTwin = matchedLoan
    ? twins.find((t) => t.loanId === matchedLoan.id)
    : twins.find((t) => t.deteriorationScore >= 32) || twins[0];

  const topDeteriorating = [...twins]
    .filter((t) => t.loanStatus !== 'PAGADO' && t.loanStatus !== 'CANCELADO')
    .sort((a, b) => b.deteriorationScore - a.deteriorationScore || b.dpdCurrent - a.dpdCurrent)
    .slice(0, 5);

  const topRecoverable = [...twins]
    .filter((t) => t.loanStatus !== 'PAGADO' && t.loanStatus !== 'CANCELADO' && t.currentPrincipalBalance > 0)
    .sort((a, b) => b.recoveryProbabilityPct - a.recoveryProbabilityPct || a.deteriorationScore - b.deteriorationScore)
    .slice(0, 5);

  // 1. Query about clients with deterioration
  if (
    qLower.includes('deterioro') ||
    qLower.includes('mayor riesgo') ||
    qLower.includes('empeor') ||
    qLower.includes('plan b')
  ) {
    const evidenceItems: AlteraQueryEvidenceItem[] = topDeteriorating.map((t) => ({
      loanId: t.loanId,
      loanNumber: t.loanNumber,
      customerId: t.customerId,
      customerName: t.customerName,
      metricLabel: `Deterioro ${t.deteriorationScore}/100 · ${t.dpdCurrent} DPD`,
      metricValue: `${t.currency} ${t.currentPrincipalBalance.toFixed(2)} expuestos`,
      severity: t.priority,
    }));

    return {
      query: q,
      interpretedIntent: 'DETECCION_DETERIORO_TEMPRANO',
      headline: `${topDeteriorating.length} créditos con mayor índice de deterioro detectado`,
      narrative:
        topDeteriorating.length === 0
          ? 'No se detectan créditos activos con deterioro en la base actual.'
          : `ALTERA identificó ${signals.length} señales preventivas activas. El caso prioritario es ${topDeteriorating[0].customerName} (${topDeteriorating[0].loanNumber}) con índice de deterioro ${topDeteriorating[0].deteriorationScore}/100, ${topDeteriorating[0].dpdCurrent} días de atraso y saldo de ${topDeteriorating[0].currency} ${topDeteriorating[0].currentPrincipalBalance.toFixed(2)}.`,
      evidenceItems,
      recommendedNextTab: 'preventive_plan_b',
      targetLoanId: topDeteriorating[0]?.loanId,
      targetCustomerId: topDeteriorating[0]?.customerId,
      explainability: {
        whatWasDetected: 'Ranking de deterioro crediticio en cartera activa real.',
        dataUsed: [
          `${portfolio.totalAnalyzedLoans} préstamos analizados`,
          `${signals.length} señales de Plan B Preventivo`,
        ],
        whyRiskOrOpportunityExists: 'Combinación determinística de DPD, cambio en últimas 3 cuotas, promesas incumplidas y alertas Centinela.',
        variablesConsidered: [
          { label: 'Deterioro promedio cartera', value: `${portfolio.averageDeteriorationScore}/100`, weightOrImpact: 'Base cartera' },
          { label: 'Alertas prioritarias', value: String(portfolio.criticalAlertsCount), weightOrImpact: 'Acción inmediata' },
        ],
        alternativesEvaluated: ['Escenario Actual', 'Plan B Preventivo', 'Reestructuración dentro de política'],
        whyRecommended: 'Permite contener migración hacia tramos superiores antes del cierre mensual.',
        expectedOutcomeIfNoAction: 'Los créditos en señal temprana y mora moderada tienden a escalar de tramo si no reciben gestión en 7 días.',
        confidencePct: topDeteriorating[0]?.explainability.confidencePct ?? 82,
        dataLimitations: portfolio.dataLimitations,
      },
      generatedAtIso: new Date().toISOString(),
    };
  }

  // 2. Query about restructuring, extraordinary payment, reduced installment, or modifying conditions
  if (
    qLower.includes('reestructur') ||
    qLower.includes('abono') ||
    qLower.includes('cuota') ||
    qLower.includes('condicion') ||
    qLower.includes('escenario') ||
    qLower.includes('sucede si') ||
    qLower.includes('pasa si')
  ) {
    const loanObj = loans.find((l) => l.id === targetTwin?.loanId) ?? loans[0];
    if (loanObj && targetTwin) {
      let interventionType: AlteraInterventionType = 'ESTRATEGIA_COBRANZA_PREVENTIVA';
      const customParams: AlteraUniverseParameters = { interventionType };

      if (qLower.includes('abono')) {
        interventionType = 'ABONO_EXTRAORDINARIO';
        customParams.interventionType = interventionType;
        customParams.extraordinaryPaymentAmount = round2(targetTwin.currentPrincipalBalance * 0.25);
      } else if (qLower.includes('reestructur')) {
        interventionType = 'REESTRUCTURACION_PLAZO';
        customParams.interventionType = interventionType;
        customParams.restructuredTermMonths = Math.max(4, targetTwin.remainingTermInstallments + 4);
      } else if (qLower.includes('reduc') || qLower.includes('cuota')) {
        interventionType = 'REDUCCION_TEMPORAL_CUOTA';
        customParams.interventionType = interventionType;
        customParams.temporaryReductionPct = 25;
        customParams.temporaryReductionMonths = 2;
      } else if (qLower.includes('fecha')) {
        interventionType = 'CAMBIO_FECHA_PAGO';
        customParams.interventionType = interventionType;
        customParams.dueDateShiftDays = 7;
      }

      const sim = simulateAlternativeUniverses({
        loan: loanObj,
        twin: targetTwin,
        parameters: customParams,
        creditPolicy,
        alteraConfig,
        asOfDateIso,
      });

      const evidenceItems: AlteraQueryEvidenceItem[] = sim.universes.map((u) => ({
        loanId: sim.loanId,
        loanNumber: sim.loanNumber,
        customerId: sim.customerId,
        customerName: sim.customerName,
        metricLabel: `${u.title} (${u.interventionTypeLabel})`,
        metricValue: `Recup. ${u.projectedRecoveryPct}% · Cuota ${sim.currency} ${u.projectedInstallmentAmount.toFixed(2)}`,
        severity: u.isAlteraRecommended ? 'ALTA' : 'INFO',
      }));

      return {
        query: q,
        interpretedIntent: `SIMULACION_${interventionType}`,
        headline: sim.alteraRecommendationHeadline,
        narrative: `Sobre el préstamo ${sim.loanNumber} (${sim.customerName}, saldo ${sim.currency} ${sim.currentBalance.toFixed(2)}), ALTERA simuló 3 universos en modo de solo lectura. ${sim.alteraRecommendationDetail}`,
        evidenceItems,
        recommendedNextTab: 'alternative_universes',
        targetLoanId: sim.loanId,
        targetCustomerId: sim.customerId,
        explainability: sim.explainability,
        generatedAtIso: new Date().toISOString(),
      };
    }
  }

  // 3. Query about highest recovery probability
  if (qLower.includes('recuperaci') || qLower.includes('probabilidad') || qLower.includes('sano') || qLower.includes('cumplidor')) {
    const evidenceItems: AlteraQueryEvidenceItem[] = topRecoverable.map((t) => ({
      loanId: t.loanId,
      loanNumber: t.loanNumber,
      customerId: t.customerId,
      customerName: t.customerName,
      metricLabel: `Prob. Recuperación ${t.recoveryProbabilityPct}%`,
      metricValue: `Puntualidad ${t.patterns.punctualityRatePct}% · ${t.currency} ${t.currentPrincipalBalance.toFixed(2)}`,
      severity: 'BAJA',
    }));

    return {
      query: q,
      interpretedIntent: 'RANKING_RECUPERACION',
      headline: `Top ${topRecoverable.length} créditos con mayor probabilidad estimada de recuperación`,
      narrative:
        topRecoverable.length === 0
          ? 'No hay préstamos activos para calcular ranking de recuperación.'
          : `La cartera activa mantiene una probabilidad media de recuperación de ${portfolio.averageRecoveryProbabilityPct}%. Encabezan ${topRecoverable.map((t) => `${t.loanNumber} (${t.recoveryProbabilityPct}%)`).join(', ')}.`,
      evidenceItems,
      recommendedNextTab: 'credit_intelligence',
      targetLoanId: topRecoverable[0]?.loanId,
      targetCustomerId: topRecoverable[0]?.customerId,
      explainability: {
        whatWasDetected: 'Créditos con mayor estabilidad de pago y probabilidad de recuperación.',
        dataUsed: [`${portfolio.totalAnalyzedLoans} gemelos digitales evaluados`],
        whyRiskOrOpportunityExists: 'Alta puntualidad histórica, cero o mínimo atraso actual y ausencia de promesas incumplidas.',
        variablesConsidered: [
          { label: 'Probabilidad promedio recuperación', value: `${portfolio.averageRecoveryProbabilityPct}%`, weightOrImpact: 'Cartera activa' },
        ],
        alternativesEvaluated: ['Continuidad sin cambios', 'Contacto preventivo ligero'],
        whyRecommended: 'Permite enfocar capacidad operativa en los créditos con señales tempranas.',
        expectedOutcomeIfNoAction: 'Mantenimiento regular del flujo contractual esperado.',
        confidencePct: 86,
        dataLimitations: portfolio.dataLimitations,
      },
      generatedAtIso: new Date().toISOString(),
    };
  }

  // 4. General / Customer / Portfolio fallback grounded answer
  const fallbackEvidence: AlteraQueryEvidenceItem[] = [
    {
      metricLabel: 'Créditos Analizados (Gemelos Digitales)',
      metricValue: `${portfolio.totalAnalyzedLoans} préstamos · ${dnas.length} clientes`,
      severity: 'INFO',
    },
    {
      metricLabel: 'Exposición Activa DOP / USD',
      metricValue: `DOP ${portfolio.activeExposureDop.toLocaleString()} · USD ${portfolio.activeExposureUsd.toLocaleString()}`,
      severity: 'INFO',
    },
    {
      metricLabel: 'Señales Plan B Preventivo / Alertas Prioritarias',
      metricValue: `${portfolio.preventiveSignalsCount} señales · ${portfolio.criticalAlertsCount} prioritarias`,
      severity: portfolio.criticalAlertsCount > 0 ? 'ALTA' : 'BAJA',
    },
    ...(topDeteriorating[0]
      ? [
          {
            loanId: topDeteriorating[0].loanId,
            loanNumber: topDeteriorating[0].loanNumber,
            customerId: topDeteriorating[0].customerId,
            customerName: topDeteriorating[0].customerName,
            metricLabel: 'Principal foco de atención',
            metricValue: `${topDeteriorating[0].loanNumber} · Deterioro ${topDeteriorating[0].deteriorationScore}/100`,
            severity: topDeteriorating[0].priority,
          },
        ]
      : []),
  ];

  return {
    query: q,
    interpretedIntent: 'DIAGNOSTICO_INTEGRAL_CARTERA',
    headline: 'Diagnóstico Integral ALTERA sobre Cartera Real AxyCore',
    narrative: `Cartera analizada: ${portfolio.totalAnalyzedLoans} préstamos (${portfolio.totalAnalyzedCustomers} clientes). Riesgo promedio de deterioro: ${portfolio.averageDeteriorationScore}/100; probabilidad promedio de recuperación: ${portfolio.averageRecoveryProbabilityPct}%. Existen ${portfolio.preventiveSignalsCount} casos candidatos a Plan B Preventivo.`,
    evidenceItems: fallbackEvidence,
    recommendedNextTab: topDeteriorating.length > 0 ? 'preventive_plan_b' : 'digital_twin',
    targetLoanId: topDeteriorating[0]?.loanId,
    targetCustomerId: topDeteriorating[0]?.customerId,
    explainability: {
      whatWasDetected: 'Resumen prescriptivo multi-cartera sobre base real.',
      dataUsed: ['loans', 'loan_installments', 'payments', 'collection_accounts', 'payment_promises', 'risk_alerts'],
      whyRiskOrOpportunityExists: 'Evaluación continua de puntualidad, exposición y señales tempranas sin alterar operaciones activas.',
      variablesConsidered: [
        { label: 'Deterioro promedio', value: `${portfolio.averageDeteriorationScore}/100`, weightOrImpact: 'Global' },
        { label: 'Recuperación promedio', value: `${portfolio.averageRecoveryProbabilityPct}%`, weightOrImpact: 'Global' },
      ],
      alternativesEvaluated: ['Consulta de deterioro', 'Simulación de universos', 'Plan B Preventivo'],
      whyRecommended: 'Provee punto de partida fundamentado en los datos reales del tenant activo.',
      expectedOutcomeIfNoAction: 'Los casos prioritarios mantienen tendencia proyectada según su Gemelo Digital.',
      confidencePct: 84,
      dataLimitations: portfolio.dataLimitations,
    },
    generatedAtIso: new Date().toISOString(),
  };
}
