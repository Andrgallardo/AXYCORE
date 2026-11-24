import type { ApplicationFormStep } from './applicationFieldValidation';

export interface OriginationStepMeta {
  step: ApplicationFormStep;
  shortLabel: string;
  fullLabel: string;
}

export const ORIGINATION_STEPS: OriginationStepMeta[] = [
  { step: 1, shortLabel: 'Solicitante', fullLabel: 'Datos del Solicitante' },
  { step: 2, shortLabel: 'Laboral y Finanzas', fullLabel: 'Información Laboral y Finanzas' },
  { step: 3, shortLabel: 'Condiciones', fullLabel: 'Condiciones del Préstamo' },
  { step: 4, shortLabel: 'Referencias y Docs', fullLabel: 'Referencias y Documentos' },
  { step: 5, shortLabel: 'Consentimiento', fullLabel: 'Revisión y Consentimiento' },
];

export interface OriginationProgressInput {
  currentStep: ApplicationFormStep;
  stepValid: Record<ApplicationFormStep, boolean>;
  stepErrorCounts: Record<ApplicationFormStep, number>;
  attemptedSteps: Partial<Record<ApplicationFormStep, boolean>>;
}

export type OriginationStepStatus = 'complete' | 'current' | 'error' | 'upcoming';

export interface OriginationProgressSummary {
  currentStep: ApplicationFormStep;
  totalSteps: number;
  currentStepMeta: OriginationStepMeta;
  completedValidSteps: number;
  remainingStepsAfterCurrent: number;
  remainingToCompleteCount: number;
  errorStepsCount: number;
  progressPercent: number;
  isReadyToSubmit: boolean;
  remainingHeadline: string;
  remainingDetail: string;
  stepStatuses: Record<ApplicationFormStep, OriginationStepStatus>;
}

const ALL_STEPS: ApplicationFormStep[] = [1, 2, 3, 4, 5];

export function computeOriginationProgress(
  input: OriginationProgressInput
): OriginationProgressSummary {
  const { currentStep, stepValid, stepErrorCounts, attemptedSteps } = input;
  const totalSteps = ALL_STEPS.length;
  const currentStepMeta =
    ORIGINATION_STEPS.find((s) => s.step === currentStep) ?? ORIGINATION_STEPS[0];

  const stepStatuses = {} as Record<ApplicationFormStep, OriginationStepStatus>;
  let completedValidSteps = 0;
  let errorStepsCount = 0;

  for (const s of ALL_STEPS) {
    const isAttemptedOrPassed = Boolean(attemptedSteps[s]) || s < currentStep;
    const isValid = Boolean(stepValid[s]);
    const hasErrors = (stepErrorCounts[s] ?? 0) > 0;

    if (s === currentStep) {
      if (isAttemptedOrPassed && hasErrors) {
        stepStatuses[s] = 'error';
        errorStepsCount += 1;
      } else {
        stepStatuses[s] = 'current';
      }
      if (isValid && (s === 5 || Boolean(attemptedSteps[s]))) {
        completedValidSteps += 1;
      }
    } else if (isAttemptedOrPassed) {
      if (hasErrors) {
        stepStatuses[s] = 'error';
        errorStepsCount += 1;
      } else if (isValid) {
        stepStatuses[s] = 'complete';
        completedValidSteps += 1;
      } else {
        stepStatuses[s] = 'upcoming';
      }
    } else {
      stepStatuses[s] = 'upcoming';
    }
  }

  const allFiveValid = ALL_STEPS.every((s) => Boolean(stepValid[s]));
  const isReadyToSubmit = allFiveValid && currentStep === 5;
  const remainingStepsAfterCurrent = Math.max(0, totalSteps - currentStep);
  const remainingToCompleteCount = ALL_STEPS.filter((s) => {
    if (s < currentStep || Boolean(attemptedSteps[s])) {
      return !stepValid[s];
    }
    if (s === currentStep) {
      return !(stepValid[s] && (s === 5 || Boolean(attemptedSteps[s])));
    }
    return true;
  }).length;

  // Compute smooth visual percentage (never 100% until all 5 steps are genuinely valid)
  let progressPercent: number;
  if (allFiveValid && currentStep === 5) {
    progressPercent = 100;
  } else {
    // Endowed progress: active step gives half-step momentum (+10%), each completed valid step gives 20%
    const currentStepAlreadyCounted =
      Boolean(stepValid[currentStep]) && (currentStep === 5 || Boolean(attemptedSteps[currentStep]));
    const activeMomentum = currentStepAlreadyCounted ? 0 : 10;
    const rawPercent = completedValidSteps * 20 + activeMomentum;
    // Also reflect positional baseline when all prior steps are valid
    const priorAllValid = ALL_STEPS.filter((s) => s < currentStep).every((s) => Boolean(stepValid[s]));
    const positionalFloor = priorAllValid ? (currentStep - 1) * 20 + 10 : 10;
    progressPercent = Math.min(95, Math.max(10, Math.max(rawPercent, positionalFloor)));
  }

  let remainingHeadline: string;
  let remainingDetail: string;

  if (isReadyToSubmit) {
    remainingHeadline = 'Proceso completo — listo para enviar';
    remainingDetail = 'Todos los 5 pasos están validados';
  } else if (currentStep === 5) {
    if (errorStepsCount > 0 && ALL_STEPS.some((s) => s < 5 && (stepErrorCounts[s] ?? 0) > 0)) {
      const priorErrors = ALL_STEPS.filter((s) => s < 5 && (stepErrorCounts[s] ?? 0) > 0).length;
      remainingHeadline =
        priorErrors === 1
          ? 'Último paso · 1 paso anterior requiere corrección'
          : `Último paso · ${priorErrors} pasos anteriores requieren corrección`;
      remainingDetail = 'Corrige los campos pendientes para habilitar el envío';
    } else {
      remainingHeadline = 'Último paso para completar tu solicitud';
      remainingDetail = 'Revisa el resumen y acepta el consentimiento Ley 172-13';
    }
  } else if (remainingStepsAfterCurrent === 1) {
    remainingHeadline = 'Falta 1 paso para finalizar';
    remainingDetail =
      errorStepsCount > 0
        ? `${errorStepsCount} ${errorStepsCount === 1 ? 'paso requiere' : 'pasos requieren'} atención`
        : 'Siguiente: Revisión y Consentimiento';
  } else {
    remainingHeadline = `Faltan ${remainingStepsAfterCurrent} pasos para completar`;
    const nextStepMeta = ORIGINATION_STEPS.find((s) => s.step === currentStep + 1);
    remainingDetail =
      errorStepsCount > 0
        ? `${errorStepsCount} ${errorStepsCount === 1 ? 'paso con campos por corregir' : 'pasos con campos por corregir'}`
        : nextStepMeta
        ? `Siguiente: ${nextStepMeta.shortLabel}`
        : 'Completa los datos requeridos para continuar';
  }

  return {
    currentStep,
    totalSteps,
    currentStepMeta,
    completedValidSteps,
    remainingStepsAfterCurrent,
    remainingToCompleteCount,
    errorStepsCount,
    progressPercent,
    isReadyToSubmit,
    remainingHeadline,
    remainingDetail,
    stepStatuses,
  };
}
