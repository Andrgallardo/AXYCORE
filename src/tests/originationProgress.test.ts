import { describe, expect, it } from 'vitest';
import { computeOriginationProgress } from '../engine/originationProgress';

describe('computeOriginationProgress', () => {
  it('starts on Step 1 with 4 remaining steps and 10% initial momentum', () => {
    const res = computeOriginationProgress({
      currentStep: 1,
      stepValid: { 1: false, 2: false, 3: true, 4: true, 5: false },
      stepErrorCounts: { 1: 4, 2: 2, 3: 0, 4: 0, 5: 1 },
      attemptedSteps: {},
    });

    expect(res.currentStep).toBe(1);
    expect(res.totalSteps).toBe(5);
    expect(res.remainingStepsAfterCurrent).toBe(4);
    expect(res.completedValidSteps).toBe(0);
    expect(res.progressPercent).toBe(10);
    expect(res.isReadyToSubmit).toBe(false);
    expect(res.remainingHeadline).toBe('Faltan 4 pasos para completar');
    expect(res.stepStatuses).toEqual({
      1: 'current',
      2: 'upcoming',
      3: 'upcoming',
      4: 'upcoming',
      5: 'upcoming',
    });
  });

  it('tracks completed prior steps and updates remaining count cleanly across steps 2 to 4', () => {
    const step2 = computeOriginationProgress({
      currentStep: 2,
      stepValid: { 1: true, 2: false, 3: true, 4: true, 5: false },
      stepErrorCounts: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 1 },
      attemptedSteps: { 1: true },
    });
    expect(step2.completedValidSteps).toBe(1);
    expect(step2.remainingStepsAfterCurrent).toBe(3);
    expect(step2.progressPercent).toBe(30);
    expect(step2.remainingHeadline).toBe('Faltan 3 pasos para completar');
    expect(step2.stepStatuses[1]).toBe('complete');
    expect(step2.stepStatuses[2]).toBe('current');

    const step4 = computeOriginationProgress({
      currentStep: 4,
      stepValid: { 1: true, 2: true, 3: true, 4: true, 5: false },
      stepErrorCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
      attemptedSteps: { 1: true, 2: true, 3: true },
    });
    expect(step4.completedValidSteps).toBe(3);
    expect(step4.remainingStepsAfterCurrent).toBe(1);
    expect(step4.progressPercent).toBe(70);
    expect(step4.remainingHeadline).toBe('Falta 1 paso para finalizar');
  });

  it('never reaches 100% if an earlier step still has validation errors', () => {
    const res = computeOriginationProgress({
      currentStep: 5,
      stepValid: { 1: false, 2: true, 3: true, 4: true, 5: true },
      stepErrorCounts: { 1: 2, 2: 0, 3: 0, 4: 0, 5: 0 },
      attemptedSteps: { 1: true, 2: true, 3: true, 4: true, 5: true },
    });

    expect(res.isReadyToSubmit).toBe(false);
    expect(res.progressPercent).toBeLessThan(100);
    expect(res.errorStepsCount).toBe(1);
    expect(res.stepStatuses[1]).toBe('error');
    expect(res.remainingHeadline).toContain('1 paso anterior requiere corrección');
  });

  it('reaches 100% and marks ready-to-submit when on Step 5 with all 5 steps valid', () => {
    const res = computeOriginationProgress({
      currentStep: 5,
      stepValid: { 1: true, 2: true, 3: true, 4: true, 5: true },
      stepErrorCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      attemptedSteps: { 1: true, 2: true, 3: true, 4: true, 5: true },
    });

    expect(res.isReadyToSubmit).toBe(true);
    expect(res.progressPercent).toBe(100);
    expect(res.completedValidSteps).toBe(5);
    expect(res.remainingStepsAfterCurrent).toBe(0);
    expect(res.remainingHeadline).toBe('Proceso completo — listo para enviar');
  });
});
