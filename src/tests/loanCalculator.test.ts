import { describe, expect, it } from 'vitest';
import {
  buildMotorV2CalculatorConfig,
  calculateLoanSimulation,
  calculateLoanWithParameters,
  compareLoanSimulations,
  createAxyCalculatorEngine,
  DEFAULT_CALCULATOR_CONFIG,
  extractBcrdExchangeRate,
  simulateOriginationWithMotorV2,
  type CalculatorInput,
  type CalculatorSimulationResult,
} from '../engine/loanCalculatorEngine';
import { DEFAULT_POLICY_V2, type EngineEvaluationInput } from '../engine/decisionEngineV2';
import { buildBreadcrumbsForSection } from '../engine/navigationBreadcrumbs';
import { canRoleAccessSection } from '../engine/rbac';

function makeDatos(extra: Partial<CalculatorInput> = {}): CalculatorInput {
  return {
    moneda: 'DOP',
    monto: 100000,
    frecuencia: 'Mensual',
    plazo: 12,
    fecha: '2026-10-02',
    usarSugerida: true,
    tipo: 'Fija',
    gastos: 'Descontar',
    ...extra,
  };
}

function verificarPlan(r: CalculatorSimulationResult) {
  expect(r.cuotas).toHaveLength(r.numeroCuotas);
  expect(r.cuotas[r.cuotas.length - 1].balance).toBe(0);

  let cap = 0;
  let int = 0;
  let total = 0;
  let prev = Math.round(r.montoFinanciado * 100);

  for (const c of r.cuotas) {
    const cp = Math.round(c.capital * 100);
    const it = Math.round(c.interes * 100);
    expect(Math.round(c.cuota * 100)).toBe(cp + it);
    expect(Math.round(c.balance * 100)).toBe(prev - cp);
    cap += cp;
    int += it;
    total += Math.round(c.cuota * 100);
    prev -= cp;
  }

  expect(cap).toBe(Math.round(r.montoFinanciado * 100));
  expect(int).toBe(Math.round(r.totalIntereses * 100));
  expect(total).toBe(Math.round(r.totalAPagar * 100));
}

describe('AxyCore Integrated Loan Calculator Engine (Exact Reference Parity)', () => {
  it('simulates all DOP combinations across 4 frequencies x 2 interest types x 2 expense modes', () => {
    for (const f of ['Diaria', 'Semanal', 'Quincenal', 'Mensual'] as const) {
      for (const t of ['Fija', 'Insoluta'] as const) {
        for (const g of ['Descontar', 'Financiar'] as const) {
          const result = calculateLoanSimulation(
            makeDatos({
              frecuencia: f,
              plazo: f === 'Diaria' ? 120 : 12,
              tipo: t,
              gastos: g,
            })
          );
          verificarPlan(result);
        }
      }
    }
  });

  it('enforces exact USD rate and legal-fee tier boundaries without gaps', () => {
    const usdCases: [number, number, number][] = [
      [1000, 5, 20],
      [1000.01, 5, 25],
      [1001, 5, 25],
      [1500, 5, 25],
      [1500.01, 4.5, 35],
      [1501, 4.5, 35],
      [2000, 4.5, 35],
      [2000.01, 4, 50],
      [2001, 4, 50],
      [3000, 4, 50],
      [3000.01, 4, 75],
      [3001, 4, 75],
      [5000, 4, 75],
      [5000.01, 4, 150],
      [5001, 4, 150.03],
    ];

    for (const [monto, tasaEsperada, gastoEsperado] of usdCases) {
      const r = calculateLoanSimulation(
        makeDatos({ moneda: 'USD', monto, tasaCambio: 63.5 })
      );
      expect(r.tasaAplicada).toBe(tasaEsperada);
      expect(r.gastosLegales).toBe(gastoEsperado);
      verificarPlan(r);
    }
  });

  it('enforces exact DOP rate and legal-fee tier boundaries without gaps', () => {
    const dopCases: [number, number, number][] = [
      [30000, 5, 1000],
      [30000.01, 4.5, 1500],
      [30001, 4.5, 1500],
      [150000, 4.5, 1500],
      [150000.01, 4, 4500],
      [150001, 4, 4500.03],
    ];

    for (const [monto, tasaEsperada, gastoEsperado] of dopCases) {
      const r = calculateLoanSimulation(makeDatos({ monto }));
      expect(r.tasaAplicada).toBe(tasaEsperada);
      expect(r.gastosLegales).toBe(gastoEsperado);
      verificarPlan(r);
    }
  });

  it('matches the exact reference vector for DOP 100,000 Fija 4.5% monthly 12 installments', () => {
    const r = calculateLoanSimulation(makeDatos());
    expect(r.totalIntereses).toBe(54000);
    expect(r.totalAPagar).toBe(154000);
    expect(r.montoNetoRecibir).toBe(98500);
    expect(r.cuotaInicial).toBe(12833.33);
    verificarPlan(r);
  });

  it('matches the exact reference vector for USD 2,000 Financed at 3% custom rate', () => {
    const r = calculateLoanSimulation(
      makeDatos({
        moneda: 'USD',
        monto: 2000,
        tasaCambio: 63.5,
        gastos: 'Financiar',
        usarSugerida: false,
        tasaPersonalizada: 3,
      })
    );
    expect(r.tasaAplicada).toBe(3);
    expect(r.montoFinanciado).toBe(2035);
    expect(r.montoNetoRecibir).toBe(2000);
    expect(r.totalIntereses).toBe(732.6);
    expect(r.totalAPagar).toBe(2767.6);
    expect(r.equivalenteDOP?.montoFinanciado).toBe(129222.5);
    verificarPlan(r);
  });

  it('supports USD Insoluta Semanal Financed, 0% rate, and original-principal tier calculation', () => {
    verificarPlan(
      calculateLoanSimulation(
        makeDatos({
          moneda: 'USD',
          monto: 5001,
          tasaCambio: 63.5,
          tipo: 'Insoluta',
          frecuencia: 'Semanal',
          gastos: 'Financiar',
        })
      )
    );

    const zeroRate = calculateLoanSimulation(
      makeDatos({ usarSugerida: false, tasaPersonalizada: 0, tipo: 'Insoluta' })
    );
    expect(zeroRate.totalIntereses).toBe(0);
    verificarPlan(zeroRate);

    const financedBoundary = calculateLoanSimulation(
      makeDatos({ monto: 150000, gastos: 'Financiar' })
    );
    expect(financedBoundary.tasaAplicada).toBe(4.5);
    expect(financedBoundary.gastosLegales).toBe(1500);
  });

  it('handles month-end clamping on leap years and exact frequency due-date increments', () => {
    const leap = calculateLoanSimulation(makeDatos({ fecha: '2028-01-31', plazo: 3 }));
    expect(leap.cuotas[0].fecha).toBe('2028-02-29');
    expect(leap.cuotas[1].fecha).toBe('2028-03-31');
    expect(leap.cuotas[2].fecha).toBe('2028-04-30');

    const firstDates: [CalculatorInput['frecuencia'], string][] = [
      ['Diaria', '2026-10-03'],
      ['Semanal', '2026-10-09'],
      ['Quincenal', '2026-10-17'],
      ['Mensual', '2026-11-02'],
    ];
    for (const [frecuencia, expectedDate] of firstDates) {
      expect(calculateLoanSimulation(makeDatos({ frecuencia })).cuotas[0].fecha).toBe(
        expectedDate
      );
    }
  });

  it('compares Fija vs Insoluta without mutating input object and supports PARAMETROS override', () => {
    const d = makeDatos();
    const original = JSON.stringify(d);
    const cmp = compareLoanSimulations(d);
    expect(JSON.stringify(d)).toBe(original);
    expect(cmp.insoluta.cuotas[0].interes).toBeGreaterThan(cmp.insoluta.cuotas[11].interes);
    expect(cmp.insoluta.totalIntereses).toBeLessThan(cmp.fija.totalIntereses);

    const customConfig = JSON.parse(JSON.stringify(DEFAULT_CALCULATOR_CONFIG));
    customConfig.DOP[1].tasa = 3;
    const filas = [
      {
        ID_PARAMETRO: 'CALCULADORA_CONFIG_V1',
        ACTIVO: true,
        VALOR_TEXTO: JSON.stringify(customConfig),
      },
    ];
    expect(calculateLoanWithParameters(makeDatos(), filas).tasaAplicada).toBe(3);
    expect(() => calculateLoanWithParameters(makeDatos(), [])).toThrow();
    expect(() => calculateLoanWithParameters(makeDatos(), [...filas, ...filas])).toThrow();
  });

  it('rejects all invalid inputs per reference validation suite', () => {
    const invalidInputs: Partial<CalculatorInput>[] = [
      { monto: '' },
      { monto: -1 },
      { monto: 0 },
      { plazo: 0 },
      { plazo: -1 },
      { plazo: 1.5 },
      { plazo: null as unknown as number },
      { moneda: '' },
      { frecuencia: '' },
      { fecha: '2026-02-30' },
      { usarSugerida: null as unknown as boolean },
      { usarSugerida: false, tasaPersonalizada: -1 },
      { usarSugerida: false, tasaPersonalizada: '' },
      { moneda: 'USD', tasaCambio: 0 },
      { moneda: 'USD', tasaCambio: -1 },
      { moneda: 'USD', tasaCambio: '' },
      { gastos: '' },
      { tipo: '' },
      { monto: 100, gastos: 'Descontar' },
    ];

    for (const invalid of invalidInputs) {
      expect(() => calculateLoanSimulation(makeDatos(invalid))).toThrow();
    }
  });

  it('handles Por período (SoloInteresesInicial) accurately for Fija and Insoluta and rejects k >= plazo', () => {
    for (const tipoPeriodo of ['Fija', 'Insoluta'] as const) {
      const r = calculateLoanSimulation(
        makeDatos({
          plazo: 12,
          tipo: tipoPeriodo,
          modalidadPago: 'SoloInteresesInicial',
          cuotasSoloInteres: 5,
        })
      );
      expect(r.cuotasSoloInteres).toBe(5);
      expect(r.cuotasAmortizacion).toBe(7);
      for (let j = 0; j < 5; j++) {
        expect(r.cuotas[j].capital).toBe(0);
        expect(r.cuotas[j].balance).toBe(r.montoFinanciado);
        expect(r.cuotas[j].etapa).toBe('Solo intereses');
      }
      expect(r.cuotas[5].capital).toBeGreaterThan(0);
      expect(r.cuotas[5].etapa).toBe('Amortización');
      expect(r.cuotas[11].balance).toBe(0);
      verificarPlan(r);
    }

    expect(() =>
      calculateLoanSimulation(
        makeDatos({
          plazo: 12,
          modalidadPago: 'SoloInteresesInicial',
          cuotasSoloInteres: 12,
        })
      )
    ).toThrow();
  });

  it('extracts official BCRD sale exchange rate and publication date cleanly', () => {
    const sample =
      '<div>Tipo de cambio 30 de Septiembre 2026 Compra 59.5224 Venta 60.0783 Reservas internacionales</div>';
    const r = extractBcrdExchangeRate(sample);
    expect(r.venta).toBe(60.0783);
    expect(r.fecha).toBe('30 de Septiembre 2026');
    expect(r.fuente).toBe('Banco Central de la República Dominicana (BCRD)');

    // Also verifies drop-in engine factory API
    const legacyMotor = createAxyCalculatorEngine();
    expect(legacyMotor.sugerir('DOP', 100000)).toEqual({ tasa: 4.5, gastosLegales: 1500 });
  });

  it('integrates cleanly with AxyCore RBAC and navigation breadcrumbs', () => {
    expect(canRoleAccessSection('ADMIN', 'loan_calculator')).toBe(true);
    expect(canRoleAccessSection('BUSINESS_OFFICER', 'loan_calculator')).toBe(true);
    expect(canRoleAccessSection('EXTERNAL_CLIENT', 'loan_calculator')).toBe(true);

    const trail = buildBreadcrumbsForSection({
      activeSection: 'loan_calculator',
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });
    expect(trail.map((s) => s.label)).toEqual([
      'Inicio',
      'Préstamos',
      'Calculadora de Préstamos',
    ]);
    expect(trail[2].isCurrent).toBe(true);
  });
});

function makeOriginationCustomer(
  overrides: Partial<EngineEvaluationInput['customer']> = {}
): EngineEvaluationInput['customer'] {
  return {
    phone: '8095551234',
    address: 'Av. Winston Churchill 102, Santo Domingo',
    email: 'carlos@example.com',
    residenceMonths: 48,
    housingType: 'PROPIA',
    housingPayment: 0,
    socialMediaDeclared: 'YES',
    socialMediaHandle: '@carlosr',
    ...overrides,
  };
}

function makeOriginationApp(
  overrides: Partial<EngineEvaluationInput['application']> = {}
): EngineEvaluationInput['application'] {
  return {
    id: 'app_calc_v2_1',
    organizationId: 'org_axycore_main',
    applicantType: 'INDIVIDUAL',
    productCode: 'PERSONAL_DOP',
    currency: 'DOP',
    requestedAmount: 100000,
    requestedTermMonths: 12,
    paymentFrequency: 'MENSUAL',
    amortizationMethod: 'SALDO_INSOLUTO',
    loanPurpose: 'Mejora de vivienda',
    loanPurposeDescription: 'Remodelación y equipamiento de vivienda principal.',
    financialData: {
      activityType: 'Empleado privado',
      employerOrBusinessName: 'Grupo Caribe',
      occupationOrRole: 'Ingeniero Senior',
      employmentMonths: 48,
      incomeSourceType: 'FIJA_RECURRENTE',
      primaryNetIncome: 180000,
      additionalIncomeStatus: 'EXPLICIT_NONE',
      additionalNetIncome: 0,
      declaredTotalMonthlyIncome: 180000,
      incomeCurrency: 'DOP',
      essentialExpenses: 40000,
      housingPayment: 0,
      housingIncludedInExpenses: false,
      debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
      debtCount: 0,
      totalDebtBalance: 0,
      currentDebtPayments: 0,
    },
    references: [
      { name: 'Ana Pérez', relationship: 'Hermana', phone: '8095559988' },
      { name: 'Luis Gómez', relationship: 'Colega', phone: '8095557766' },
    ],
    declaredDocumentsSummary: {
      hasIdentityDoc: true,
      hasIncomeEvidence: true,
      hasAddressProof: true,
    },
    ...overrides,
  };
}

describe('Motor de Decisiones Crediticias V2 + Loan Calculator Integration', () => {
  it('builds Motor V2 calculator configs with exact band rates, product limits, and FX overrides', () => {
    const muyBajo = buildMotorV2CalculatorConfig({
      policy: DEFAULT_POLICY_V2,
      productCode: 'PERSONAL_DOP',
      riskBandCode: 'MUY_BAJO',
    });
    expect(muyBajo.appliedMonthlyRatePct).toBe(4);
    expect(muyBajo.bandCap).toBe(500000);
    expect(muyBajo.bandMaxTermMonths).toBe(18);
    expect(muyBajo.minAmount).toBe(500);
    expect(muyBajo.maxAmount).toBe(500000);

    const bajo = buildMotorV2CalculatorConfig({
      policy: DEFAULT_POLICY_V2,
      productCode: 'EMPRESARIAL_DOP',
      riskBandCode: 'BAJO',
    });
    expect(bajo.appliedMonthlyRatePct).toBe(4.4);
    expect(bajo.bandCap).toBe(600000);

    const moderado = buildMotorV2CalculatorConfig({
      policy: DEFAULT_POLICY_V2,
      productCode: 'PERSONAL_USD',
      riskBandCode: 'MODERADO',
      overrideExchangeRate: 61.25,
    });
    expect(moderado.appliedMonthlyRatePct).toBe(4.8);
    expect(moderado.bandCap).toBe(2500);
    expect(moderado.bandMaxTermMonths).toBe(15);
    expect(moderado.effectiveExchangeRate).toBe(61.25);

    const referencia = buildMotorV2CalculatorConfig({
      policy: DEFAULT_POLICY_V2,
      productCode: 'PERSONAL_DOP',
      riskBandCode: 'REFERENCIA',
    });
    expect(referencia.appliedMonthlyRatePct).toBe(5.5);
    expect(referencia.bandCap).toBeNull();

    // Custom policy rate override propagates immediately while preserving legal fee tiers
    const customPolicy = structuredClone(DEFAULT_POLICY_V2);
    customPolicy.riskBands[0].monthlyRate = 0.0325;
    const customCfg = buildMotorV2CalculatorConfig({
      policy: customPolicy,
      productCode: 'PERSONAL_DOP',
      riskBandCode: 'MUY_BAJO',
    });
    expect(customCfg.appliedMonthlyRatePct).toBe(3.25);
    expect(customCfg.config.DOP[1].gasto).toBe(1500);
    expect(customCfg.config.DOP[1].tasa).toBe(3.25);
  });

  it('runs live Motor V2 origination simulation with BigInt parity and full policy compliance', () => {
    const out = simulateOriginationWithMotorV2({
      application: makeOriginationApp(),
      customer: makeOriginationCustomer(),
      policy: DEFAULT_POLICY_V2,
      fechaDesembolso: '2026-10-02',
    });

    expect(out.calculatorError).toBeNull();
    expect(out.scoring.totalScore).toBeGreaterThanOrEqual(80);
    expect(out.selectedSimulation).not.toBeNull();
    expect(out.comparison).not.toBeNull();

    if (out.selectedSimulation && out.comparison) {
      verificarPlan(out.selectedSimulation);
      verificarPlan(out.comparison.fija);
      verificarPlan(out.comparison.insoluta);
      expect(out.selectedSimulation.tasaAplicada).toBe(
        Number(((out.scoring.riskBand.monthlyRate ?? 0) * 100).toFixed(6))
      );
      expect(out.comparison.insoluta.totalIntereses).toBeLessThan(
        out.comparison.fija.totalIntereses
      );
    }

    expect(out.complianceChecks.every((c) => c.passed)).toBe(true);
    expect(out.monthlyEquivalentInstallment).toBeGreaterThan(0);
    expect(out.projectedDtiWithSimulation).toBeLessThanOrEqual(
      DEFAULT_POLICY_V2.capacityConfig.maxProjectedDti
    );
  });

  it('scales installments properly for Quincenal and Semanal and flags disallowed policy frequencies', () => {
    const quincenal = simulateOriginationWithMotorV2({
      application: makeOriginationApp({ requestedTermMonths: 6 }),
      customer: makeOriginationCustomer(),
      policy: DEFAULT_POLICY_V2,
      frequencyOverride: 'Quincenal',
      fechaDesembolso: '2026-10-02',
    });
    expect(quincenal.installmentCount).toBe(12);
    expect(quincenal.selectedSimulation?.numeroCuotas).toBe(12);
    if (quincenal.selectedSimulation) {
      verificarPlan(quincenal.selectedSimulation);
      expect(quincenal.monthlyEquivalentInstallment).toBe(
        Number((quincenal.selectedSimulation.cuotaInicial * 2).toFixed(2))
      );
    }
    expect(quincenal.complianceChecks.find((c) => c.key === 'frequency')?.passed).toBe(false);

    const semanal = simulateOriginationWithMotorV2({
      application: makeOriginationApp({ requestedTermMonths: 6 }),
      customer: makeOriginationCustomer(),
      policy: DEFAULT_POLICY_V2,
      frequencyOverride: 'Semanal',
      fechaDesembolso: '2026-10-02',
    });
    expect(semanal.installmentCount).toBe(24);
    if (semanal.selectedSimulation) {
      verificarPlan(semanal.selectedSimulation);
    }
  });

  it('evaluates USD FX stress check and generates DOP equivalent schedule for USD loans with DOP income', () => {
    const usdOut = simulateOriginationWithMotorV2({
      application: makeOriginationApp({
        productCode: 'PERSONAL_USD',
        currency: 'USD',
        requestedAmount: 2000,
        requestedTermMonths: 12,
      }),
      customer: makeOriginationCustomer(),
      policy: DEFAULT_POLICY_V2,
      overrideExchangeRate: 61.5,
      fechaDesembolso: '2026-10-02',
    });

    expect(usdOut.calculatorError).toBeNull();
    expect(usdOut.selectedSimulation?.tasaCambio).toBe(61.5);
    expect(usdOut.selectedSimulation?.equivalenteDOP?.montoSolicitado).toBe(123000);
    if (usdOut.selectedSimulation) {
      verificarPlan(usdOut.selectedSimulation);
    }
    const fxCheck = usdOut.complianceChecks.find((c) => c.key === 'fx_stress');
    expect(fxCheck).toBeDefined();
    expect(fxCheck?.passed).toBe(true);
  });

  it('handles critical fallback rate and surfaces calculatorError cleanly when Descontar expenses exceed principal', () => {
    const smallAmountOut = simulateOriginationWithMotorV2({
      application: makeOriginationApp({
        requestedAmount: 500,
        requestedTermMonths: 3,
      }),
      customer: makeOriginationCustomer(),
      policy: DEFAULT_POLICY_V2,
      gastos: 'Descontar',
      fechaDesembolso: '2026-10-02',
    });
    expect(smallAmountOut.selectedSimulation).toBeNull();
    expect(smallAmountOut.calculatorError).toContain('gastos descontados');

    // Financiar on 500 DOP succeeds without throwing
    const financedSmallOut = simulateOriginationWithMotorV2({
      application: makeOriginationApp({
        requestedAmount: 500,
        requestedTermMonths: 3,
      }),
      customer: makeOriginationCustomer(),
      policy: DEFAULT_POLICY_V2,
      gastos: 'Financiar',
      fechaDesembolso: '2026-10-02',
    });
    expect(financedSmallOut.calculatorError).toBeNull();
    expect(financedSmallOut.selectedSimulation?.montoFinanciado).toBe(1500);

    // Missing financial data triggers CRITICO band -> falls back cleanly to referenceSimulationMonthlyRate (5.5%)
    const criticalDraftOut = simulateOriginationWithMotorV2({
      application: makeOriginationApp({
        requestedAmount: 50000,
        requestedTermMonths: 6,
        financialData: {
          activityType: '',
          employerOrBusinessName: '',
          occupationOrRole: '',
          employmentMonths: 0,
          incomeSourceType: 'IRREGULAR',
          primaryNetIncome: 0,
          additionalIncomeStatus: 'EXPLICIT_NONE',
          additionalNetIncome: 0,
          declaredTotalMonthlyIncome: 0,
          incomeCurrency: 'DOP',
          essentialExpenses: 0,
          housingPayment: 0,
          housingIncludedInExpenses: false,
          debtDeclarationStatus: 'NO_DEBTS_EXPLICIT',
          debtCount: 0,
          totalDebtBalance: 0,
          currentDebtPayments: 0,
        },
      }),
      customer: makeOriginationCustomer({
        residenceMonths: 1,
        socialMediaDeclared: 'NO_MEDIA',
      }),
      policy: DEFAULT_POLICY_V2,
      fechaDesembolso: '2026-10-02',
    });
    expect(criticalDraftOut.scoring.riskBand.code).toBe('CRITICO');
    expect(criticalDraftOut.motorConfig.appliedMonthlyRatePct).toBe(5.5);
    expect(criticalDraftOut.selectedSimulation?.tasaAplicada).toBe(5.5);
    expect(criticalDraftOut.complianceChecks.find((c) => c.key === 'band_cap')?.passed).toBe(
      false
    );
  });
});
