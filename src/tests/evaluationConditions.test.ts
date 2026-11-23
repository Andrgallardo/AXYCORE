import { describe, expect, it } from 'vitest';
import { computeLoanConditionPreview } from '../components/LoanConditionsEditor';

describe('Evaluation & Inbox Policy-Driven Loan Condition Adjustments', () => {
  it('applies institutional DOP policy rate and legal fee scale automatically by amount', () => {
    const tier1 = computeLoanConditionPreview('DOP', {
      requestedAmount: 25000,
      termMonths: 12,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      legalFeeMode: 'DESCONTAR_DESEMBOLSO',
    });
    expect(tier1.error).toBeNull();
    expect(tier1.policyRatePct).toBe(5);
    expect(tier1.policyLegalFees).toBe(1000);
    expect(tier1.simulation?.montoFinanciado).toBe(25000);
    expect(tier1.simulation?.montoNetoRecibir).toBe(24000);

    const tier2 = computeLoanConditionPreview('DOP', {
      requestedAmount: 100000,
      termMonths: 12,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      legalFeeMode: 'DESCONTAR_DESEMBOLSO',
    });
    expect(tier2.policyRatePct).toBe(4.5);
    expect(tier2.policyLegalFees).toBe(1500);
    expect(tier2.simulation?.montoNetoRecibir).toBe(98500);

    const tier3 = computeLoanConditionPreview('DOP', {
      requestedAmount: 250000,
      termMonths: 24,
      paymentFrequency: 'MENSUAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      legalFeeMode: 'FINANCIAR',
    });
    expect(tier3.policyRatePct).toBe(4);
    expect(tier3.policyLegalFees).toBe(7500); // 3% of 250,000
    expect(tier3.simulation?.montoFinanciado).toBe(257500);
    expect(tier3.simulation?.montoNetoRecibir).toBe(250000);
  });

  it('distinguishes Interés Fijo vs Saldo Insoluto and supports all payment frequencies', () => {
    const insoluto = computeLoanConditionPreview('DOP', {
      requestedAmount: 100000,
      termMonths: 12,
      paymentFrequency: 'QUINCENAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      legalFeeMode: 'DESCONTAR_DESEMBOLSO',
    });

    const fija = computeLoanConditionPreview('DOP', {
      requestedAmount: 100000,
      termMonths: 12,
      paymentFrequency: 'QUINCENAL',
      amortizationMethod: 'INTERES_FIJO',
      legalFeeMode: 'DESCONTAR_DESEMBOLSO',
    });

    expect(insoluto.installmentCount).toBe(24);
    expect(fija.installmentCount).toBe(24);
    expect(insoluto.simulation?.tipo).toBe('Insoluta');
    expect(fija.simulation?.tipo).toBe('Fija');
    expect(fija.simulation!.totalIntereses).toBeGreaterThan(insoluto.simulation!.totalIntereses);

    const semanal = computeLoanConditionPreview('USD', {
      requestedAmount: 2500,
      termMonths: 6,
      paymentFrequency: 'SEMANAL',
      amortizationMethod: 'SALDO_INSOLUTO',
      legalFeeMode: 'FINANCIAR',
    });
    expect(semanal.policyRatePct).toBe(4);
    expect(semanal.policyLegalFees).toBe(50);
    expect(semanal.installmentCount).toBe(24);
    expect(semanal.simulation?.montoFinanciado).toBe(2550);
    expect(semanal.simulation?.montoNetoRecibir).toBe(2500);
  });
});
