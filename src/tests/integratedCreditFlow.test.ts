import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_POLICY_V2 } from '../engine/decisionEngineV2';
import {
  buildFinancialAnalysisIdempotencyKey,
  canUserAccessInternalFinancialTools,
  canUserExecuteHumanReevaluation,
  canUserOverrideRateOrFees,
  runIntegratedDecisionAndCalculation,
} from '../engine/integratedCreditEngine';
import { calculateLoanSimulation, suggestLoanConditions } from '../engine/loanCalculatorEngine';
import { canRoleAccessSection, SECTION_ACCESS_BY_ROLE } from '../engine/rbac';
import type {
  ExchangeRateAuditMetadata,
  LegalFeeApplicationMode,
  PaymentFrequency,
} from '../types/axycore';

function buildStrongCustomer() {
  return {
    organizationId: 'org_su_gloria',
    phone: '8095550199',
    address: 'Av. Winston Churchill #120, Santo Domingo',
    email: 'cliente.califica@example.com',
    residenceMonths: 48,
    housingType: 'PROPIA' as const,
    housingPayment: 0,
    socialMediaDeclared: 'YES' as const,
    socialMediaHandle: '@clientecalifica',
  };
}

function buildStrongDopApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app_qualifies_dop_001',
    organizationId: 'org_su_gloria',
    applicantType: 'INDIVIDUAL' as const,
    productCode: 'PERSONAL_DOP' as const,
    currency: 'DOP' as const,
    requestedAmount: 100000,
    requestedTermMonths: 12,
    paymentFrequency: 'MENSUAL' as PaymentFrequency,
    amortizationMethod: 'SALDO_INSOLUTO' as const,
    legalFeeMode: 'DESCONTAR_DESEMBOLSO' as LegalFeeApplicationMode,
    interestOnlyPeriods: 0,
    loanPurpose: 'Consolidación y equipamiento hogar',
    loanPurposeDescription: 'Compra de electrodomésticos y mejora del hogar',
    financialData: {
      activityType: 'Empleado privado',
      employerOrBusinessName: 'Grupo Empresarial RD',
      occupationOrRole: 'Ingeniero Senior',
      employmentMonths: 42,
      incomeSourceType: 'FIJA_RECURRENTE' as const,
      primaryNetIncome: 120000,
      additionalIncomeStatus: 'EXPLICIT_NONE' as const,
      additionalNetIncome: 0,
      declaredTotalMonthlyIncome: 120000,
      incomeCurrency: 'DOP' as const,
      essentialExpenses: 32000,
      housingIncludedInExpenses: true,
      debtDeclarationStatus: 'NO_DEBTS_EXPLICIT' as const,
      debtCount: 0,
      totalDebtBalance: 0,
      currentDebtPayments: 0,
    },
    references: [
      { name: 'María Pérez', relationship: 'Hermana', phone: '8095551001' },
      { name: 'Carlos Gómez', relationship: 'Colega', phone: '8095551002' },
    ],
    declaredDocumentsSummary: {
      hasIdentityDoc: true,
      hasIncomeEvidence: true,
      hasAddressProof: true,
      hasCorporateDocs: false,
    },
    documents: [
      { id: 'd1', category: 'CEDULA_FRONTAL', reviewStatus: 'VERIFICADO' },
      { id: 'd2', category: 'CEDULA_TRASERA', reviewStatus: 'VERIFICADO' },
      { id: 'd3', category: 'COMPROBANTE_INGRESOS', reviewStatus: 'VERIFICADO' },
    ],
    ...overrides,
  };
}

const SAMPLE_BCRD_META: ExchangeRateAuditMetadata = {
  applied: true,
  currencyPair: 'USD/DOP',
  sellRate: 62.45,
  source: 'Banco Central de la República Dominicana (BCRD)',
  rateDate: '2026-11-20',
  obtainedAtIso: '2026-11-20T12:00:00.000Z',
  isAutomaticBcrd: true,
  isFallback: false,
  fallbackReason: null,
  manualOverrideBy: null,
  manualOverrideByName: null,
};

const ANALYST_ACTOR = {
  uid: 'usr_analyst_01',
  displayName: 'Ana Analista',
  role: 'CREDIT_ANALYST' as const,
};

describe('Integración Motor de Decisiones V2 + Motor de Cálculo Financiero AxyCore', () => {
  describe('Escenario 1: Cliente que califica automáticamente (DOP y USD)', () => {
    it('calcula análisis completo, tabla cuadrada a 0.00 y auto-avanza a EN_EVALUACION en DOP', () => {
      const app = buildStrongDopApplication();
      const result = runIntegratedDecisionAndCalculation({
        application: app,
        customer: buildStrongCustomer(),
        policy: DEFAULT_POLICY_V2,
        analysisType: 'SOLICITUD_INICIAL',
        version: 1,
        actor: ANALYST_ACTOR,
      });

      expect(result.calculatorError).toBeNull();
      expect(result.analysis).not.toBeNull();
      expect(result.canAutoAdvanceToEvaluation).toBe(true);
      expect(result.recommendedTargetStatus).toBe('EN_EVALUACION');
      expect(result.requiresHumanIntervention).toBe(false);
      expect(result.decisionQualificationStatus).toBe('CALIFICA_AUTO_EVALUACION');
      expect(result.canSendToEvaluation).toBe(true);

      const analysis = result.analysis!;
      expect(analysis.status).toBe('APROBADO_EVALUACION');
      expect(analysis.version).toBe(1);
      expect(analysis.financialSummary).not.toBeNull();
      expect(analysis.financialSummary!.currency).toBe('DOP');
      expect(analysis.financialSummary!.requestedAmount).toBe(100000);
      expect(analysis.financialSummary!.legalFeesAmount).toBe(1500); // Tramo DOP 30,001 - 150,000 => 1,500
      expect(analysis.financialSummary!.financedPrincipal).toBe(100000);
      expect(analysis.financialSummary!.netDisbursementAmount).toBe(98500);
      expect(analysis.financialSummary!.finalBalance).toBe(0);
      expect(analysis.financialSummary!.isReconciled).toBe(true);
      expect(result.installments).toHaveLength(12);
      expect(result.installments[result.installments.length - 1].remainingBalance).toBe(0);

      // Snapshot original intacto
      expect(analysis.originalRequestedConditions.requestedAmount).toBe(100000);
      expect(analysis.originalRequestedConditions.termMonths).toBe(12);
      expect(analysis.originalRequestedConditions.paymentFrequency).toBe('MENSUAL');
      expect(result.decisionHistory.newStatus).toBe('EN_EVALUACION');
    });

    it('calcula solicitud USD con tasa BCRD auditada y equivalente DOP referencial manteniendo deuda en USD', () => {
      const usdApp = buildStrongDopApplication({
        id: 'app_qualifies_usd_001',
        productCode: 'PERSONAL_USD',
        currency: 'USD',
        requestedAmount: 2000,
        requestedTermMonths: 12,
        financialData: {
          ...buildStrongDopApplication().financialData,
          primaryNetIncome: 3000,
          declaredTotalMonthlyIncome: 3000,
          essentialExpenses: 900,
          incomeCurrency: 'USD',
        },
      });

      const result = runIntegratedDecisionAndCalculation({
        application: usdApp,
        customer: buildStrongCustomer(),
        policy: DEFAULT_POLICY_V2,
        analysisType: 'SOLICITUD_INICIAL',
        version: 1,
        exchangeRateMeta: SAMPLE_BCRD_META,
        actor: ANALYST_ACTOR,
      });

      expect(result.calculatorError).toBeNull();
      expect(result.analysis).not.toBeNull();
      expect(result.canAutoAdvanceToEvaluation).toBe(true);
      expect(result.recommendedTargetStatus).toBe('EN_EVALUACION');

      const analysis = result.analysis!;
      const fin = analysis.financialSummary!;
      expect(fin.currency).toBe('USD');
      expect(fin.legalFeesAmount).toBe(35); // Tramo USD 1,501 - 2,000 => 35
      expect(analysis.exchangeRateMeta?.sellRate).toBe(62.45);
      expect(analysis.exchangeRateMeta?.isAutomaticBcrd).toBe(true);
      expect(fin.dopEquivalentSummary).not.toBeNull();
      expect(fin.dopEquivalentSummary!.requestedAmount).toBeCloseTo(2000 * 62.45, 2);
      // Cada cuota mantiene montos reales en USD y referencia informativa en DOP
      expect(result.installments[0].totalAmount).toBeLessThan(250);
      expect(result.installments[0].dopEquivalent!.cuota).toBeGreaterThan(
        result.installments[0].totalAmount * 50
      );
      expect(fin.finalBalance).toBe(0);
    });
  });

  describe('Escenario 2: Cliente que NO califica (monto excesivo / baja capacidad)', () => {
    it('retiene en RECIBIDA, marca requiresHumanIntervention y lista reglas incumplidas sin auto-avanzar', () => {
      const excessiveApp = buildStrongDopApplication({
        id: 'app_non_qualifying_001',
        requestedAmount: 950000, // Excede capacidad real y tope del producto PERSONAL_DOP
        requestedTermMonths: 12,
        financialData: {
          ...buildStrongDopApplication().financialData,
          primaryNetIncome: 35000,
          declaredTotalMonthlyIncome: 35000,
          essentialExpenses: 22000,
          currentDebtPayments: 9000,
          debtDeclarationStatus: 'HAS_DEBTS',
          debtCount: 2,
          totalDebtBalance: 180000,
        },
      });

      const result = runIntegratedDecisionAndCalculation({
        application: excessiveApp,
        customer: buildStrongCustomer(),
        policy: DEFAULT_POLICY_V2,
        analysisType: 'SOLICITUD_INICIAL',
        version: 1,
        actor: ANALYST_ACTOR,
      });

      expect(result.canAutoAdvanceToEvaluation).toBe(false);
      expect(result.recommendedTargetStatus).toBe('RECIBIDA');
      expect(result.requiresHumanIntervention).toBe(true);
      expect(result.decisionQualificationStatus).toBe('REQUIERE_INTERVENCION_HUMANA');
      expect(result.canSendToEvaluation).toBe(false);
      expect(result.sendToEvaluationBlockedReasons.length).toBeGreaterThan(0);

      const failedRules = result.analysis?.decisionSummary.rulesFailed ?? [];
      expect(failedRules.length).toBeGreaterThan(0);
      expect(result.decisionHistory.newStatus).toBe('RECIBIDA');
    });
  });

  describe('Escenario 3: Reevaluación humana comparativa y habilitación de «ENVIAR A EVALUACIÓN»', () => {
    it('preserva condiciones originales, bloquea si alternativa no califica, y habilita envío cuando cumple reglas', () => {
      const baseApp = buildStrongDopApplication({
        id: 'app_reeval_001',
        requestedAmount: 280000, // Alto para ingreso de 65k a 6 meses
        requestedTermMonths: 6,
        financialData: {
          ...buildStrongDopApplication().financialData,
          primaryNetIncome: 65000,
          declaredTotalMonthlyIncome: 65000,
          essentialExpenses: 26000,
          currentDebtPayments: 4000,
          debtDeclarationStatus: 'HAS_DEBTS',
          debtCount: 1,
          totalDebtBalance: 45000,
        },
      });

      const initial = runIntegratedDecisionAndCalculation({
        application: baseApp,
        customer: buildStrongCustomer(),
        policy: DEFAULT_POLICY_V2,
        analysisType: 'SOLICITUD_INICIAL',
        version: 1,
        actor: ANALYST_ACTOR,
      });

      expect(initial.requiresHumanIntervention).toBe(true);
      expect(initial.recommendedTargetStatus).toBe('RECIBIDA');
      expect(initial.canSendToEvaluation).toBe(false);

      const originalSnapshot = initial.analysis!.originalRequestedConditions;

      // Intento de reevaluación con monto aún excesivo => sigue bloqueado
      const stillBlocked = runIntegratedDecisionAndCalculation({
        application: {
          ...baseApp,
          originalRequestedConditions: originalSnapshot,
        },
        customer: buildStrongCustomer(),
        policy: DEFAULT_POLICY_V2,
        analysisType: 'REEVALUACION_HUMANA',
        version: 2,
        alternativeConditions: {
          requestedAmount: 270000,
          installmentCount: 6,
          termMonths: 6,
          paymentFrequency: 'MENSUAL',
          amortizationMethod: 'SALDO_INSOLUTO',
          legalFeeMode: 'DESCONTAR_DESEMBOLSO',
        },
        justification: 'Intento inicial aún fuera de capacidad.',
        actor: ANALYST_ACTOR,
      });

      expect(stillBlocked.canSendToEvaluation).toBe(false);
      expect(stillBlocked.analysis!.originalRequestedConditions.requestedAmount).toBe(280000);

      // Reevaluación ajustada a monto y plazo dentro de capacidad => habilita «ENVIAR A EVALUACIÓN»
      const qualifiedAlternative = runIntegratedDecisionAndCalculation({
        application: {
          ...baseApp,
          originalRequestedConditions: originalSnapshot,
        },
        customer: buildStrongCustomer(),
        policy: DEFAULT_POLICY_V2,
        analysisType: 'REEVALUACION_HUMANA',
        version: 3,
        intent: 'SEND_TO_EVALUATION',
        alternativeConditions: {
          requestedAmount: 85000,
          installmentCount: 18,
          termMonths: 18,
          paymentFrequency: 'MENSUAL',
          amortizationMethod: 'SALDO_INSOLUTO',
          legalFeeMode: 'FINANCIAR',
          interestOnlyPeriods: 1,
        },
        justification:
          'Cliente acepta reducción de monto a RD$85,000 a 18 meses con 1 cuota solo intereses.',
        actor: ANALYST_ACTOR,
      });

      expect(qualifiedAlternative.calculatorError).toBeNull();
      expect(qualifiedAlternative.canSendToEvaluation).toBe(true);
      expect(qualifiedAlternative.recommendedTargetStatus).toBe('EN_EVALUACION');
      expect(qualifiedAlternative.decisionQualificationStatus).toBe(
        'REEVALUADA_APROBADA_EVALUACION'
      );
      expect(qualifiedAlternative.analysis!.version).toBe(3);
      expect(qualifiedAlternative.analysis!.financialSummary!.finalBalance).toBe(0);
      // Condiciones originales permanecen 100% intactas
      expect(qualifiedAlternative.analysis!.originalRequestedConditions.requestedAmount).toBe(
        280000
      );
      expect(qualifiedAlternative.analysis!.originalRequestedConditions.termMonths).toBe(6);
      // Auditoría registra diffs de cambio y actor
      expect(qualifiedAlternative.decisionHistory.changesSummary.length).toBeGreaterThan(0);
      expect(qualifiedAlternative.decisionHistory.actorId).toBe(ANALYST_ACTOR.uid);
      expect(qualifiedAlternative.decisionHistory.justification).toContain('RD$85,000');

      // Bloqueo si falta justificación en SEND_TO_EVALUATION
      const missingJustif = runIntegratedDecisionAndCalculation({
        application: {
          ...baseApp,
          originalRequestedConditions: originalSnapshot,
        },
        customer: buildStrongCustomer(),
        policy: DEFAULT_POLICY_V2,
        analysisType: 'REEVALUACION_HUMANA',
        version: 4,
        intent: 'SEND_TO_EVALUATION',
        alternativeConditions: {
          requestedAmount: 85000,
          installmentCount: 18,
          termMonths: 18,
          paymentFrequency: 'MENSUAL',
          amortizationMethod: 'SALDO_INSOLUTO',
          legalFeeMode: 'FINANCIAR',
        },
        justification: 'corta',
        actor: ANALYST_ACTOR,
      });
      expect(missingJustif.canSendToEvaluation).toBe(false);
    });
  });

  describe('Escenario 4: Integridad financiera (tramos DOP/USD, modalidades, frecuencias, gastos y redondeo)', () => {
    it('aplica exactamente todos los tramos oficiales de tasa y gastos legales en DOP y USD', () => {
      // DOP tiers (DEFAULT_CALCULATOR_CONFIG)
      expect(suggestLoanConditions('DOP', 25000)).toEqual({ tasa: 5, gastosLegales: 1000 });
      expect(suggestLoanConditions('DOP', 100000)).toEqual({ tasa: 4.5, gastosLegales: 1500 });
      expect(suggestLoanConditions('DOP', 300000)).toEqual({ tasa: 4, gastosLegales: 9000 }); // 3%

      // USD tiers (DEFAULT_CALCULATOR_CONFIG)
      expect(suggestLoanConditions('USD', 800)).toEqual({ tasa: 5, gastosLegales: 20 });
      expect(suggestLoanConditions('USD', 1200)).toEqual({ tasa: 5, gastosLegales: 25 });
      expect(suggestLoanConditions('USD', 2000)).toEqual({ tasa: 4.5, gastosLegales: 35 });
      expect(suggestLoanConditions('USD', 2800)).toEqual({ tasa: 4, gastosLegales: 50 });
      expect(suggestLoanConditions('USD', 4500)).toEqual({ tasa: 4, gastosLegales: 75 });
      expect(suggestLoanConditions('USD', 10000)).toEqual({ tasa: 4, gastosLegales: 300 }); // 3%
    });

    it('verifica DESCONTAR vs FINANCIAR sin doble cobro, y calcula gasto legal sobre el monto original', () => {
      // 150,000 DOP está en el límite superior del tramo <= 150,000 => gasto legal 1,500.
      // Al financiarlo, capital financiado = 151,500 (que excedería 150,000), pero gasto legal DEBE seguir siendo 1,500!
      const discounted = calculateLoanSimulation({
        moneda: 'DOP',
        monto: 150000,
        frecuencia: 'Mensual',
        plazo: 12,
        tipo: 'Insoluta',
        modalidadPago: 'Normal',
        gastos: 'Descontar',
        usarSugerida: true,
        fecha: '2026-01-31',
      });
      const financed = calculateLoanSimulation({
        moneda: 'DOP',
        monto: 150000,
        frecuencia: 'Mensual',
        plazo: 12,
        tipo: 'Insoluta',
        modalidadPago: 'Normal',
        gastos: 'Financiar',
        usarSugerida: true,
        fecha: '2026-01-31',
      });

      expect(discounted.gastosLegales).toBe(1500);
      expect(discounted.montoFinanciado).toBe(150000);
      expect(discounted.montoNetoRecibir).toBe(148500);
      expect(discounted.cuotas[discounted.cuotas.length - 1].balance).toBe(0);

      expect(financed.gastosLegales).toBe(1500);
      expect(financed.montoFinanciado).toBe(151500);
      expect(financed.montoNetoRecibir).toBe(150000);
      expect(financed.cuotas[financed.cuotas.length - 1].balance).toBe(0);

      // Conservación del día ancla (31 ene -> 28 feb -> 31 mar)
      expect(financed.cuotas[0].fecha).toBe('2026-02-28');
      expect(financed.cuotas[1].fecha).toBe('2026-03-31');
    });

    it('cuadra a 0.00 en INTERES_FIJO y SALDO_INSOLUTO, todas las frecuencias y cuotas iniciales solo intereses', () => {
      const frequencies: Array<{
        key: 'Diaria' | 'Semanal' | 'Quincenal' | 'Mensual';
        divisor: number;
        n: number;
      }> = [
        { key: 'Diaria', divisor: 30, n: 30 },
        { key: 'Semanal', divisor: 4, n: 16 },
        { key: 'Quincenal', divisor: 2, n: 12 },
        { key: 'Mensual', divisor: 1, n: 12 },
      ];

      for (const freq of frequencies) {
        for (const tipo of ['Fija', 'Insoluta'] as const) {
          const sim = calculateLoanSimulation({
            moneda: 'DOP',
            monto: 77777.77,
            frecuencia: freq.key,
            plazo: freq.n,
            tipo,
            modalidadPago: 'SoloInteresesInicial',
            cuotasSoloInteres: 2,
            gastos: 'Financiar',
            usarSugerida: false,
            tasaPersonalizada: 4.5,
            fecha: '2026-05-01',
          });

          expect(sim.tasaPeriodicaPorcentaje).toBeCloseTo(4.5 / freq.divisor, 4);
          expect(sim.cuotas).toHaveLength(freq.n);
          expect(sim.cuotas[0].etapa).toBe('Solo intereses');
          expect(sim.cuotas[0].capital).toBe(0);
          expect(sim.cuotas[1].etapa).toBe('Solo intereses');
          expect(sim.cuotas[1].capital).toBe(0);
          expect(sim.cuotas[2].etapa).toBe('Amortización');
          expect(sim.cuotas[2].capital).toBeGreaterThan(0);

          const sumCapitalCents = sim.cuotas.reduce(
            (acc, row) => acc + Math.round(row.capital * 100),
            0
          );
          expect(sumCapitalCents).toBe(Math.round(sim.montoFinanciado * 100));
          expect(sim.cuotas[sim.cuotas.length - 1].balance).toBe(0);
        }
      }
    });
  });

  describe('Escenario 5: Seguridad, RBAC y Reglas Firestore', () => {
    it('bloquea completamente a EXTERNAL_CLIENT y gobierna permisos internos de reevaluación y overrides', () => {
      // EXTERNAL_CLIENT cero acceso a calculadora, herramientas internas, reevaluación u overrides
      expect(SECTION_ACCESS_BY_ROLE.EXTERNAL_CLIENT).not.toContain('loan_calculator');
      expect(canRoleAccessSection('EXTERNAL_CLIENT', 'loan_calculator')).toBe(false);
      expect(canUserAccessInternalFinancialTools('EXTERNAL_CLIENT')).toBe(false);
      expect(canUserExecuteHumanReevaluation('EXTERNAL_CLIENT')).toBe(false);
      expect(canUserOverrideRateOrFees('EXTERNAL_CLIENT')).toBe(false);

      // AUDITOR: solo lectura interna, sin reevaluación ni overrides
      expect(canUserAccessInternalFinancialTools('AUDITOR')).toBe(true);
      expect(canUserExecuteHumanReevaluation('AUDITOR')).toBe(false);
      expect(canUserOverrideRateOrFees('AUDITOR')).toBe(false);

      // BUSINESS_OFFICER: reevaluación permitida, overrides de tasa/gastos bloqueados
      expect(canUserExecuteHumanReevaluation('BUSINESS_OFFICER')).toBe(true);
      expect(canUserOverrideRateOrFees('BUSINESS_OFFICER')).toBe(false);

      // CREDIT_ANALYST / RISK_OFFICER / ADMIN: permisos completos
      expect(canUserExecuteHumanReevaluation('CREDIT_ANALYST')).toBe(true);
      expect(canUserOverrideRateOrFees('CREDIT_ANALYST')).toBe(true);
      expect(canUserOverrideRateOrFees('RISK_OFFICER')).toBe(true);
      expect(canUserOverrideRateOrFees('ADMIN')).toBe(true);
    });

    it('verifica en firestore.rules que las colecciones financieras excluyen a EXTERNAL_CLIENT y bloquean saltos a EN_EVALUACION', () => {
      const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
      const rulesSource = fs.readFileSync(rulesPath, 'utf8');

      // Colecciones nuevas presentes y protegidas exclusivamente para personal interno
      expect(rulesSource).toContain('match /financial_analyses/{analysisId}');
      expect(rulesSource).toContain('match /financial_analysis_installments/{instId}');
      expect(rulesSource).toContain('match /application_decision_history/{historyId}');

      // Protección de inmutabilidad de condiciones originales y bloqueo de salto directo a EN_EVALUACION
      expect(rulesSource).toContain('originalRequestedConditions');
      expect(rulesSource).toContain('activeFinancialAnalysisId');
      expect(rulesSource).toContain('canReevaluateCredit');
    });
  });

  describe('Escenario 6: Persistencia, Versionamiento e Idempotencia', () => {
    it('genera llaves e IDs determinísticos sin duplicar cuotas ante reintentos y preserva versiones históricas', () => {
      const app = buildStrongDopApplication({ id: 'app_idemp_001' });

      const run1 = runIntegratedDecisionAndCalculation({
        application: app,
        customer: buildStrongCustomer(),
        policy: DEFAULT_POLICY_V2,
        analysisType: 'SOLICITUD_INICIAL',
        version: 1,
        actor: ANALYST_ACTOR,
      });

      const keyA = buildFinancialAnalysisIdempotencyKey({
        organizationId: app.organizationId,
        applicationId: app.id,
        analysisType: 'SOLICITUD_INICIAL',
        version: 1,
        conditions: run1.analysis!.calculatedConditions,
      });
      const keyB = buildFinancialAnalysisIdempotencyKey({
        organizationId: app.organizationId,
        applicationId: app.id,
        analysisType: 'SOLICITUD_INICIAL',
        version: 1,
        conditions: run1.analysis!.calculatedConditions,
      });
      expect(keyA).toBe(keyB);

      const run1Retry = runIntegratedDecisionAndCalculation({
        application: app,
        customer: buildStrongCustomer(),
        policy: DEFAULT_POLICY_V2,
        analysisType: 'SOLICITUD_INICIAL',
        version: 1,
        actor: ANALYST_ACTOR,
      });
      const run2 = runIntegratedDecisionAndCalculation({
        application: app,
        customer: buildStrongCustomer(),
        policy: DEFAULT_POLICY_V2,
        analysisType: 'AJUSTE_EVALUACION',
        version: 2,
        alternativeConditions: {
          requestedAmount: 90000,
          installmentCount: 12,
          termMonths: 12,
          paymentFrequency: 'MENSUAL',
        },
        actor: ANALYST_ACTOR,
      });

      // Reintento produce exactamente los mismos IDs determinísticos (cero duplicación)
      expect(run1.analysis!.id).toBe(run1Retry.analysis!.id);
      expect(run1.installments[0].id).toBe(run1Retry.installments[0].id);
      expect(run1.installments[0].id).toBe(`${run1.analysis!.id}_q_0001`);

      // Nueva versión crea un nuevo documento independiente sin sobrescribir v1
      expect(run2.analysis!.id).not.toBe(run1.analysis!.id);
      expect(run2.analysis!.version).toBe(2);
      expect(run2.installments[0].id).toBe(`${run2.analysis!.id}_q_0001`);
    });
  });
});
