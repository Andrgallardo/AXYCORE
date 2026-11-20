import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileSpreadsheet,
  History,
  Info,
  Lock,
  RefreshCw,
  Scale,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  AMORTIZATION_METHOD_LABELS,
  LEGAL_FEE_MODE_LABELS,
  PAYMENT_FREQUENCY_LABELS,
  canUserAccessInternalFinancialTools,
  canUserExecuteHumanReevaluation,
  canUserOverrideRateOrFees,
  computeEquivalentMonthsFromInstallments,
  computeInstallmentCountFromMonths,
  type AlternativeConditionsOverrideInput,
} from '../engine/integratedCreditEngine';
import { getSantoDomingoTodayIso } from '../engine/loanCalculatorEngine';
import {
  fetchFinancialAnalysisInstallments,
  retryApplicationFinancialProcessing,
  runHumanReevaluationAndPersist,
  sendReevaluatedApplicationToEvaluation,
} from '../services/axycoreStore';
import type {
  AmortizationMethod,
  ApplicationRecord,
  CustomerRecord,
  FinancialAnalysisInstallmentRecord,
  FinancialAnalysisRecord,
  LegalFeeApplicationMode,
  PaymentFrequency,
} from '../types/axycore';
import {
  APPLICATION_STATUS_LABELS,
  SCORING_STATUS_LABELS,
  formatMoney,
  formatTimestamp,
  formatUserFacingError,
} from '../utils/formatters';

interface ApplicationFinancialAnalysisPanelProps {
  application: ApplicationRecord;
  customer: CustomerRecord | null;
  mode?: 'INBOX' | 'EVALUATION';
  onStatusTransitioned?: (nextStatus: ApplicationRecord['status']) => void;
}

const ANALYSIS_TYPE_LABELS: Record<FinancialAnalysisRecord['analysisType'], string> = {
  SOLICITUD_INICIAL: 'Automático al Recibir',
  REEVALUACION_HUMANA: 'Reevaluación Humana',
  AJUSTE_EVALUACION: 'Ajuste en Evaluación',
  ACTUALIZACION_DATOS: 'Actualización de Datos',
};

const ANALYSIS_STATUS_LABELS: Record<FinancialAnalysisRecord['status'], string> = {
  VIGENTE: 'Vigente',
  HISTORICO: 'Histórico',
  APROBADO_EVALUACION: 'Aprobado para Evaluación',
  RECHAZADO: 'Rechazado',
};

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const clean = iso.slice(0, 10);
  const d = new Date(`${clean}T12:00:00`);
  if (Number.isNaN(d.getTime())) return clean;
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function buildInputFingerprint(input: {
  amount: string;
  installments: string;
  frequency: PaymentFrequency;
  modality: AmortizationMethod;
  legalFeeMode: LegalFeeApplicationMode;
  interestOnlyPeriods: string;
  disbursementDate: string;
  useSuggestedRate: boolean;
  customRatePct: string;
  customLegalFees: string;
  manualFx: string;
}): string {
  return JSON.stringify(input);
}

export function ApplicationFinancialAnalysisPanel({
  application,
  customer,
  mode = 'INBOX',
  onStatusTransitioned,
}: ApplicationFinancialAnalysisPanelProps) {
  const {
    financialAnalyses,
    applicationDecisionHistory,
    activeOrTestPolicy,
    userProfile,
    rbac,
    setActiveSection,
    setSelectedApplicationId,
  } = useAxyCore();

  // Strict security guard: EXTERNAL_CLIENT must NEVER view internal analyses, rules, or re-evaluation tools.
  const canViewInternalTools =
    rbac.isInternalStaff &&
    userProfile?.role !== 'EXTERNAL_CLIENT' &&
    canUserAccessInternalFinancialTools(userProfile?.role);

  const canReevaluate =
    canViewInternalTools && canUserExecuteHumanReevaluation(userProfile?.role);
  const canOverridePricing =
    canViewInternalTools && canUserOverrideRateOrFees(userProfile?.role);

  const appAnalyses = useMemo(
    () =>
      financialAnalyses
        .filter((a) => a.applicationId === application.id)
        .sort((a, b) => (b.version || 0) - (a.version || 0)),
    [financialAnalyses, application.id]
  );

  const appHistory = useMemo(
    () =>
      applicationDecisionHistory
        .filter((h) => h.applicationId === application.id)
        .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))),
    [applicationDecisionHistory, application.id]
  );

  const defaultSelectedId = useMemo(() => {
    if (application.approvedEvaluationAnalysisId) {
      const match = appAnalyses.find((a) => a.id === application.approvedEvaluationAnalysisId);
      if (match) return match.id;
    }
    if (application.activeFinancialAnalysisId) {
      const match = appAnalyses.find((a) => a.id === application.activeFinancialAnalysisId);
      if (match) return match.id;
    }
    const active = appAnalyses.find(
      (a) => a.status === 'VIGENTE' || a.status === 'APROBADO_EVALUACION'
    );
    return active?.id ?? appAnalyses[0]?.id ?? null;
  }, [
    appAnalyses,
    application.activeFinancialAnalysisId,
    application.approvedEvaluationAnalysisId,
  ]);

  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(defaultSelectedId);
  useEffect(() => {
    setSelectedAnalysisId(defaultSelectedId);
  }, [application.id, defaultSelectedId]);

  const selectedAnalysis = useMemo(
    () => appAnalyses.find((a) => a.id === selectedAnalysisId) ?? appAnalyses[0] ?? null,
    [appAnalyses, selectedAnalysisId]
  );

  // Persisted amortization rows loaded strictly from Firestore financial_analysis_installments
  const [persistedInstallments, setPersistedInstallments] = useState<
    FinancialAnalysisInstallmentRecord[]
  >([]);
  const [loadingInstallments, setLoadingInstallments] = useState(false);
  const [installmentsError, setInstallmentsError] = useState<string | null>(null);
  const [showAllInstallments, setShowAllInstallments] = useState(false);
  const [showDopEquivalent, setShowDopEquivalent] = useState(false);
  const [showRulesDetails, setShowRulesDetails] = useState(true);
  const [showHistorySection, setShowHistorySection] = useState(false);

  useEffect(() => {
    if (!canViewInternalTools || !selectedAnalysis) {
      setPersistedInstallments([]);
      setInstallmentsError(null);
      return;
    }
    let cancelled = false;
    setLoadingInstallments(true);
    setInstallmentsError(null);
    fetchFinancialAnalysisInstallments(selectedAnalysis.id, application.organizationId)
      .then((rows) => {
        if (!cancelled) {
          setPersistedInstallments(rows);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setInstallmentsError(
            formatUserFacingError(err, 'No se pudieron cargar las cuotas guardadas desde Firestore.')
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingInstallments(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canViewInternalTools, selectedAnalysis?.id, application.organizationId]);

  // Human Re-evaluation Comparative Workspace State
  const isEligibleForHumanReevaluation =
    mode === 'INBOX' &&
    canReevaluate &&
    ['RECIBIDA', 'DEVUELTA'].includes(application.status);

  const shouldAutoOpenReeval =
    isEligibleForHumanReevaluation &&
    (Boolean(application.requiresHumanIntervention) ||
      Boolean(selectedAnalysis?.decisionSummary.requiresHumanIntervention));

  const [showReevalWorkspace, setShowReevalWorkspace] = useState<boolean>(shouldAutoOpenReeval);
  useEffect(() => {
    setShowReevalWorkspace(shouldAutoOpenReeval);
  }, [application.id, shouldAutoOpenReeval]);

  const baseConditions = useMemo(() => {
    if (selectedAnalysis) {
      const c = selectedAnalysis.calculatedConditions;
      return {
        amount: c.requestedAmount,
        frequency: c.paymentFrequency,
        installments: c.installmentCount,
        modality: c.amortizationMethod,
        legalFeeMode: c.legalFeeMode,
        interestOnlyPeriods: c.interestOnlyPeriods,
        disbursementDate: c.disbursementDate || getSantoDomingoTodayIso(),
        monthlyRatePct: c.monthlyRatePct,
        legalFees: c.legalFeesAmount,
        fxRate: selectedAnalysis.exchangeRateMeta?.sellRate ?? null,
      };
    }
    const freq = application.paymentFrequency ?? 'MENSUAL';
    const count =
      application.installmentCount && application.installmentCount > 0
        ? application.installmentCount
        : computeInstallmentCountFromMonths(application.requestedTermMonths || 12, freq);
    return {
      amount: application.requestedAmount,
      frequency: freq,
      installments: count,
      modality: application.amortizationMethod ?? 'SALDO_INSOLUTO',
      legalFeeMode: application.legalFeeMode ?? 'DESCONTAR_DESEMBOLSO',
      interestOnlyPeriods: application.interestOnlyPeriods ?? 0,
      disbursementDate: getSantoDomingoTodayIso(),
      monthlyRatePct: (application.recommendedRateMonthly ?? 0.04) * 100,
      legalFees: 0,
      fxRate: null,
    };
  }, [selectedAnalysis, application]);

  const [altAmount, setAltAmount] = useState<string>(String(baseConditions.amount));
  const [altFrequency, setAltFrequency] = useState<PaymentFrequency>(baseConditions.frequency);
  const [altInstallments, setAltInstallments] = useState<string>(String(baseConditions.installments));
  const [altModality, setAltModality] = useState<AmortizationMethod>(baseConditions.modality);
  const [altLegalFeeMode, setAltLegalFeeMode] = useState<LegalFeeApplicationMode>(
    baseConditions.legalFeeMode
  );
  const [altInterestOnly, setAltInterestOnly] = useState<string>(
    String(baseConditions.interestOnlyPeriods)
  );
  const [altDisbursementDate, setAltDisbursementDate] = useState<string>(
    baseConditions.disbursementDate
  );
  const [useSuggestedRate, setUseSuggestedRate] = useState<boolean>(true);
  const [customRatePct, setCustomRatePct] = useState<string>(
    baseConditions.monthlyRatePct.toFixed(2)
  );
  const [customLegalFees, setCustomLegalFees] = useState<string>('');
  const [manualFx, setManualFx] = useState<string>(
    baseConditions.fxRate ? String(baseConditions.fxRate) : ''
  );
  const [justification, setJustification] = useState<string>('');

  const [reevalBusy, setReevalBusy] = useState(false);
  const [sendingToEval, setSendingToEval] = useState(false);
  const [retryingInitial, setRetryingInitial] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [lastEvaluatedFingerprint, setLastEvaluatedFingerprint] = useState<string | null>(null);
  const [lastEvaluatedAnalysisId, setLastEvaluatedAnalysisId] = useState<string | null>(null);

  useEffect(() => {
    setAltAmount(String(baseConditions.amount));
    setAltFrequency(baseConditions.frequency);
    setAltInstallments(String(baseConditions.installments));
    setAltModality(baseConditions.modality);
    setAltLegalFeeMode(baseConditions.legalFeeMode);
    setAltInterestOnly(String(baseConditions.interestOnlyPeriods));
    setAltDisbursementDate(baseConditions.disbursementDate);
    setUseSuggestedRate(true);
    setCustomRatePct(baseConditions.monthlyRatePct.toFixed(2));
    setCustomLegalFees('');
    setManualFx(baseConditions.fxRate ? String(baseConditions.fxRate) : '');
    setLastEvaluatedFingerprint(null);
    setLastEvaluatedAnalysisId(null);
    setFeedback(null);
  }, [application.id]);

  if (!canViewInternalTools) {
    return null;
  }

  const currentFingerprint = buildInputFingerprint({
    amount: altAmount,
    installments: altInstallments,
    frequency: altFrequency,
    modality: altModality,
    legalFeeMode: altLegalFeeMode,
    interestOnlyPeriods: altInterestOnly,
    disbursementDate: altDisbursementDate,
    useSuggestedRate,
    customRatePct,
    customLegalFees,
    manualFx,
  });

  const buildAlternativeInput = (): AlternativeConditionsOverrideInput => {
    const parsedAmount = Number(altAmount);
    const parsedInst = Math.max(1, Math.round(Number(altInstallments) || 1));
    const equivMonths = computeEquivalentMonthsFromInstallments(parsedInst, altFrequency);
    const parsedIo = Math.max(0, Math.round(Number(altInterestOnly) || 0));
    const parsedCustomRate =
      canOverridePricing && !useSuggestedRate && customRatePct.trim() !== ''
        ? Number(customRatePct)
        : null;
    const parsedCustomFee =
      canOverridePricing && customLegalFees.trim() !== '' ? Number(customLegalFees) : null;
    const parsedManualFx =
      canOverridePricing && application.currency === 'USD' && manualFx.trim() !== ''
        ? Number(manualFx)
        : null;

    return {
      requestedAmount:
        Number.isFinite(parsedAmount) && parsedAmount > 0
          ? parsedAmount
          : application.requestedAmount,
      installmentCount: parsedInst,
      termMonths: equivMonths,
      paymentFrequency: altFrequency,
      amortizationMethod: altModality,
      legalFeeMode: altLegalFeeMode,
      interestOnlyPeriods: parsedIo,
      disbursementDate: altDisbursementDate || getSantoDomingoTodayIso(),
      useSuggestedRate: canOverridePricing ? useSuggestedRate : true,
      customMonthlyRatePct:
        parsedCustomRate !== null && Number.isFinite(parsedCustomRate) && parsedCustomRate > 0
          ? parsedCustomRate
          : null,
      customLegalFeesAmount:
        parsedCustomFee !== null && Number.isFinite(parsedCustomFee) && parsedCustomFee >= 0
          ? parsedCustomFee
          : null,
      manualExchangeRate:
        parsedManualFx !== null && Number.isFinite(parsedManualFx) && parsedManualFx > 0
          ? parsedManualFx
          : null,
    };
  };

  const handleApplySuggestedOffer = () => {
    const recOffer = selectedAnalysis?.decisionSummary.recommendedAlternative;
    const recAmt =
      recOffer && recOffer.amount > 0
        ? recOffer.amount
        : application.recommendedAmount ?? application.requestedAmount;
    const recTerm =
      recOffer && recOffer.termMonths > 0
        ? recOffer.termMonths
        : application.recommendedTermMonths ?? application.requestedTermMonths;
    const freq = recOffer?.frequency ?? altFrequency;
    setAltFrequency(freq);
    setAltAmount(String(Math.round(recAmt)));
    setAltInstallments(String(computeInstallmentCountFromMonths(recTerm, freq)));
    setFeedback({
      type: 'ok',
      msg: `Condiciones sugeridas del Motor V2 cargadas (${formatMoney(recAmt, application.currency)} a ${recTerm} meses). Presiona «Recalcular y Guardar Versión» para validar elegibilidad y generar la tabla.`,
    });
  };

  const handleRecalculateHumanReeval = async () => {
    if (!userProfile || !customer) {
      setFeedback({
        type: 'err',
        msg: 'No se encontró la ficha del cliente vinculada para ejecutar la reevaluación.',
      });
      return;
    }
    setReevalBusy(true);
    setFeedback(null);
    try {
      const altInput = buildAlternativeInput();
      const { analysis, result } = await runHumanReevaluationAndPersist({
        application,
        customer,
        policy: activeOrTestPolicy,
        existingAnalyses: appAnalyses,
        alternativeConditions: altInput,
        justification: justification.trim() || null,
        user: userProfile,
      });
      setSelectedAnalysisId(analysis.id);
      setLastEvaluatedFingerprint(currentFingerprint);
      setLastEvaluatedAnalysisId(analysis.id);
      setFeedback({
        type: result.canSendToEvaluation ? 'ok' : 'err',
        msg: result.canSendToEvaluation
          ? `Versión v${analysis.version} calculada y guardada: las condiciones alternativas CALIFICAN (${result.scoring.totalScore}/100) con tabla cuadrada a 0.00. Completa la justificación y presiona «ENVIAR A EVALUACIÓN».`
          : `Versión v${analysis.version} guardada, pero aún NO califica: ${
              result.sendToEvaluationBlockedReasons.join(' | ') ||
              'Ajuste monto, plazo o frecuencia.'
            }`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: formatUserFacingError(err, 'No se pudo ejecutar la reevaluación financiera.'),
      });
    } finally {
      setReevalBusy(false);
    }
  };

  const handleSendToEvaluation = async () => {
    if (!userProfile || !customer) return;
    setSendingToEval(true);
    setFeedback(null);
    try {
      const altInput = buildAlternativeInput();
      const { analysis } = await sendReevaluatedApplicationToEvaluation({
        application,
        customer,
        policy: activeOrTestPolicy,
        existingAnalyses: appAnalyses,
        alternativeConditions: altInput,
        justification: justification.trim(),
        user: userProfile,
      });
      setSelectedAnalysisId(analysis.id);
      setShowReevalWorkspace(false);
      setFeedback({
        type: 'ok',
        msg: `Expediente enviado oficialmente a Evaluación con Análisis Financiero v${analysis.version} y tabla de amortización persistida.`,
      });
      onStatusTransitioned?.('EN_EVALUACION');
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: formatUserFacingError(err, 'No se pudo enviar la solicitud a Evaluación.'),
      });
    } finally {
      setSendingToEval(false);
    }
  };

  const handleRetryInitialProcessing = async () => {
    if (!userProfile || !customer) return;
    setRetryingInitial(true);
    setFeedback(null);
    try {
      const res = await retryApplicationFinancialProcessing({
        application,
        customer,
        policy: activeOrTestPolicy,
        existingAnalyses: appAnalyses,
        user: userProfile,
      });
      setSelectedAnalysisId(res.analysis.id);
      setFeedback({
        type: 'ok',
        msg: res.autoAdvanced
          ? `Análisis Financiero v${res.analysis.version} generado y guardado. La solicitud calificó y avanzó automáticamente a Evaluación.`
          : `Análisis Financiero v${res.analysis.version} generado y guardado. La solicitud requiere intervención humana antes de pasar a Evaluación.`,
      });
      if (res.autoAdvanced) {
        onStatusTransitioned?.('EN_EVALUACION');
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: formatUserFacingError(err, 'No se pudo generar el análisis financiero.'),
      });
    } finally {
      setRetryingInitial(false);
    }
  };

  const fin = selectedAnalysis?.financialSummary ?? null;
  const dec = selectedAnalysis?.decisionSummary ?? null;
  const calcCond = selectedAnalysis?.calculatedConditions ?? null;

  // Strict prerequisites for «ENVIAR A EVALUACIÓN»
  const latestEvaluatedMatchesCurrentInputs =
    lastEvaluatedFingerprint !== null &&
    lastEvaluatedFingerprint === currentFingerprint &&
    selectedAnalysis !== null &&
    selectedAnalysis.id === lastEvaluatedAnalysisId;

  const isExistingActiveReevalReady =
    selectedAnalysis !== null &&
    selectedAnalysis.status === 'VIGENTE' &&
    selectedAnalysis.canSendToEvaluation &&
    Boolean(fin?.isReconciled) &&
    selectedAnalysis.installmentsCount > 0 &&
    (latestEvaluatedMatchesCurrentInputs ||
      (lastEvaluatedFingerprint === null &&
        selectedAnalysis.analysisType === 'REEVALUACION_HUMANA'));

  const sendBlockedChecklist: string[] = [];
  if (!canReevaluate) {
    sendBlockedChecklist.push('Tu rol no tiene permiso para enviar solicitudes reevaluadas a Evaluación.');
  }
  if (!['RECIBIDA', 'DEVUELTA'].includes(application.status)) {
    sendBlockedChecklist.push(
      `La solicitud ya se encuentra en estado ${APPLICATION_STATUS_LABELS[application.status]}.`
    );
  }
  if (!selectedAnalysis || !fin) {
    sendBlockedChecklist.push('Debe ejecutarse primero el cálculo financiero y guardarse una versión.');
  } else {
    if (lastEvaluatedFingerprint !== null && lastEvaluatedFingerprint !== currentFingerprint) {
      sendBlockedChecklist.push(
        'Modificaste condiciones en el Panel B; debes presionar «Recalcular y Guardar Versión» antes de enviar.'
      );
    } else if (!isExistingActiveReevalReady) {
      sendBlockedChecklist.push(
        'Debes recalcular condiciones alternativas que cumplan las reglas del Motor de Decisiones.'
      );
    }
    if (!selectedAnalysis.canSendToEvaluation) {
      sendBlockedChecklist.push(
        ...(selectedAnalysis.sendToEvaluationBlockedReasons.length > 0
          ? selectedAnalysis.sendToEvaluationBlockedReasons
          : ['Las condiciones actuales no cumplen las reglas de calificación vigentes.'])
      );
    }
    if (!fin.isReconciled || fin.finalBalance !== 0 || selectedAnalysis.installmentsCount <= 0) {
      sendBlockedChecklist.push('La tabla de amortización no está cuadrada a saldo final 0.00.');
    }
  }
  if (justification.trim().length < 10) {
    sendBlockedChecklist.push(
      'Debes ingresar una justificación de reevaluación (mínimo 10 caracteres).'
    );
  }

  const canClickSendToEvaluation =
    sendBlockedChecklist.length === 0 && !reevalBusy && !sendingToEval;

  // Build rows to display in table: prefer full persisted rows from Firestore, fallback to persisted preview while loading
  const displayRows = useMemo(() => {
    if (persistedInstallments.length > 0) {
      return persistedInstallments.map((r) => ({
        installmentNumber: r.installmentNumber,
        dueDate: r.dueDate,
        stage: r.stage,
        stageLabel: r.stage === 'SOLO_INTERESES' ? 'Solo intereses' : 'Amortización',
        principal: r.principalAmount,
        interest: r.interestAmount,
        totalPayment: r.totalAmount,
        endingBalance: r.remainingBalance,
        dopEquivalentPayment: r.dopEquivalent?.cuota ?? null,
      }));
    }
    return (selectedAnalysis?.installmentsPreview ?? []).map((r) => ({
      installmentNumber: r.numero,
      dueDate: r.fecha,
      stage: r.etapa,
      stageLabel: r.etapa === 'SOLO_INTERESES' ? 'Solo intereses' : 'Amortización',
      principal: r.capital,
      interest: r.interes,
      totalPayment: r.cuota,
      endingBalance: r.balance,
      dopEquivalentPayment: r.dopCuota ?? null,
    }));
  }, [persistedInstallments, selectedAnalysis?.installmentsPreview]);

  const visibleRows = showAllInstallments ? displayRows : displayRows.slice(0, 24);

  const handleExportCsv = () => {
    if (!selectedAnalysis || !fin || displayRows.length === 0) return;
    const isUsd = fin.currency === 'USD';
    const headers = [
      'Cuota',
      'Fecha',
      'Etapa',
      `Capital (${fin.currency})`,
      `Interes (${fin.currency})`,
      `Cuota Total (${fin.currency})`,
      `Balance Final (${fin.currency})`,
      ...(isUsd && showDopEquivalent ? ['Cuota Ref. DOP'] : []),
    ];
    const lines = [
      headers.join(','),
      ...displayRows.map((r) =>
        [
          r.installmentNumber,
          r.dueDate,
          `"${r.stageLabel}"`,
          r.principal.toFixed(2),
          r.interest.toFixed(2),
          r.totalPayment.toFixed(2),
          r.endingBalance.toFixed(2),
          ...(isUsd && showDopEquivalent
            ? [r.dopEquivalentPayment !== null ? r.dopEquivalentPayment.toFixed(2) : '']
            : []),
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Amortizacion_${application.applicationNumber}_v${selectedAnalysis.version}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const originalSnapshot =
    application.originalRequestedConditions ?? selectedAnalysis?.originalRequestedConditions ?? null;
  const failedRules = dec?.rulesFailed ?? [];
  const passedRules = dec?.rulesPassed ?? [];
  const allRules = [...failedRules, ...passedRules];
  const equivalentAltMonths = computeEquivalentMonthsFromInstallments(
    Math.max(1, Math.round(Number(altInstallments) || 1)),
    altFrequency
  );

  return (
    <div className="space-y-5">
      {/* Top Section Header */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-[#00B8FF]/20 bg-gradient-to-br from-slate-50 via-white to-sky-50/40 dark:from-[#061126] dark:via-[#08152E] dark:to-[#0A1D3D] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#0052CC] dark:text-[#00D1FF]">
                <Calculator className="w-3.5 h-3.5" />
                ANÁLISIS FINANCIERO Y TABLA DE AMORTIZACIÓN
              </span>
              {selectedAnalysis && (
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${
                    selectedAnalysis.status === 'VIGENTE' ||
                    selectedAnalysis.status === 'APROBADO_EVALUACION'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  v{selectedAnalysis.version} · {ANALYSIS_STATUS_LABELS[selectedAnalysis.status]}
                </span>
              )}
              {selectedAnalysis && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-white/10">
                  {ANALYSIS_TYPE_LABELS[selectedAnalysis.analysisType]}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Resultado integrado del Motor de Decisiones V2 y Motor de Cálculo Financiero persistido en base de datos (sin recálculo silencioso).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {appAnalyses.length > 1 && (
              <select
                aria-label="Seleccionar versión de análisis financiero"
                value={selectedAnalysis?.id ?? ''}
                onChange={(e) => setSelectedAnalysisId(e.target.value)}
                className="axy-input px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-white"
              >
                {appAnalyses.map((a) => (
                  <option key={a.id} value={a.id}>
                    v{a.version} · {ANALYSIS_TYPE_LABELS[a.analysisType]} (
                    {ANALYSIS_STATUS_LABELS[a.status]})
                  </option>
                ))}
              </select>
            )}

            {isEligibleForHumanReevaluation && (
              <button
                type="button"
                onClick={() => setShowReevalWorkspace((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                  showReevalWorkspace
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                    : 'axy-brand-gradient text-white shadow-sm'
                }`}
              >
                <Scale className="w-3.5 h-3.5" />
                <span>
                  {showReevalWorkspace
                    ? 'Ocultar Reevaluación Comparativa'
                    : 'Reevaluación Humana Comparativa'}
                </span>
              </button>
            )}

            {mode === 'INBOX' && application.status === 'EN_EVALUACION' && (
              <button
                type="button"
                onClick={() => {
                  setSelectedApplicationId(application.id);
                  setActiveSection('evaluation');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
              >
                <span>Ir a Evaluación</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Verdict Banner */}
        {selectedAnalysis && dec ? (
          <div
            className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
              dec.requiresHumanIntervention
                ? 'bg-amber-50/90 dark:bg-amber-950/35 border-amber-300/80 dark:border-amber-700/50 text-amber-950 dark:text-amber-200'
                : 'bg-emerald-50/90 dark:bg-emerald-950/35 border-emerald-300/80 dark:border-emerald-700/50 text-emerald-950 dark:text-emerald-200'
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              {dec.requiresHumanIntervention ? (
                <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs font-bold">
                  {dec.verdict} · Score Motor V2:{' '}
                  <span className="font-mono">{dec.score}/100</span> ({dec.riskBandLabel})
                </p>
                <p className="text-[11px] opacity-90">
                  Veredicto preliminar: {SCORING_STATUS_LABELS[dec.scoringStatus]} · Calculado por{' '}
                  <strong>{selectedAnalysis.calculatedByName}</strong> el{' '}
                  {formatTimestamp(selectedAnalysis.calculatedAt)}
                  {selectedAnalysis.justification
                    ? ` · Justificación: «${selectedAnalysis.justification}»`
                    : ''}
                </p>
              </div>
            </div>

            {fin && (
              <div className="text-right shrink-0">
                <p className="text-[10px] uppercase tracking-wider opacity-75">Saldo Final Tabla</p>
                <p className="text-xs font-mono font-bold">
                  {formatMoney(fin.finalBalance, fin.currency)}{' '}
                  {fin.isReconciled ? '✓ Cuadrada' : '⚠ Revisar'}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/30 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold text-amber-950 dark:text-amber-200">
                  Expediente previo sin análisis financiero persistido
                </p>
                <p className="text-amber-800 dark:text-amber-300/90 mt-0.5">
                  Esta solicitud fue registrada antes de activar la integración automática. Puedes ejecutar el Motor de Decisiones y el Motor de Cálculo Financiero ahora de forma controlada.
                </p>
              </div>
            </div>
            {canReevaluate && customer && (
              <button
                type="button"
                disabled={retryingInitial}
                onClick={handleRetryInitialProcessing}
                className="axy-brand-gradient inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${retryingInitial ? 'animate-spin' : ''}`} />
                <span>{retryingInitial ? 'Procesando...' : 'Generar Análisis Financiero y Tabla'}</span>
              </button>
            )}
          </div>
        )}

        {feedback && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
              feedback.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
            }`}
          >
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{feedback.msg}</span>
          </div>
        )}
      </div>

      {/* COMPARATIVE HUMAN RE-EVALUATION WORKSPACE */}
      {showReevalWorkspace && isEligibleForHumanReevaluation && (
        <div className="rounded-2xl border-2 border-[#0066FF]/35 dark:border-[#00D1FF]/35 bg-white dark:bg-[#07132B] p-5 space-y-5 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-white/10 pb-3">
            <div>
              <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Scale className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                Espacio de Reevaluación Humana Comparativa
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                La solicitud original del cliente permanece intacta (solo lectura). Ajusta condiciones alternativas, recalcula con Motor V2 + Motor Financiero y habilita «ENVIAR A EVALUACIÓN».
              </p>
            </div>
            {dec?.recommendedAlternative && (
              <button
                type="button"
                onClick={handleApplySuggestedOffer}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-[#00D1FF]/10 border border-sky-200 dark:border-[#00D1FF]/30 text-[#0052CC] dark:text-[#00D1FF] text-xs font-semibold cursor-pointer hover:brightness-95"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  Aplicar Oferta Sugerida (
                  {formatMoney(dec.recommendedAlternative.amount, application.currency)} /{' '}
                  {dec.recommendedAlternative.termMonths}m)
                </span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* PANEL A: IMMUTABLE ORIGINAL REQUEST */}
            <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-[#040C1E] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  Panel A · Solicitud Original (Solo Lectura)
                </span>
                <span className="text-[10px] font-mono text-slate-500">Inmutable</span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg bg-white dark:bg-[#08152E] border border-slate-200/70 dark:border-white/10">
                  <p className="text-[10px] text-slate-500">Monto Solicitado</p>
                  <p className="font-mono font-bold text-slate-900 dark:text-white">
                    {formatMoney(
                      originalSnapshot?.requestedAmount ?? application.requestedAmount,
                      application.currency
                    )}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-white dark:bg-[#08152E] border border-slate-200/70 dark:border-white/10">
                  <p className="text-[10px] text-slate-500">Plazo / Cuotas</p>
                  <p className="font-mono font-bold text-slate-900 dark:text-white">
                    {originalSnapshot?.termMonths ?? application.requestedTermMonths} meses (
                    {originalSnapshot?.installmentCount ??
                      computeInstallmentCountFromMonths(
                        application.requestedTermMonths,
                        application.paymentFrequency
                      )}{' '}
                    cuotas)
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-white dark:bg-[#08152E] border border-slate-200/70 dark:border-white/10">
                  <p className="text-[10px] text-slate-500">Frecuencia</p>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {
                      PAYMENT_FREQUENCY_LABELS[
                        originalSnapshot?.paymentFrequency ?? application.paymentFrequency
                      ]
                    }
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-white dark:bg-[#08152E] border border-slate-200/70 dark:border-white/10">
                  <p className="text-[10px] text-slate-500">Modalidad Interés</p>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {
                      AMORTIZATION_METHOD_LABELS[
                        originalSnapshot?.amortizationMethod ?? application.amortizationMethod
                      ]
                    }
                  </p>
                </div>
              </div>

              {failedRules.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-200/80 dark:border-white/10">
                  <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
                    Reglas no cumplidas ({failedRules.length}):
                  </p>
                  <ul className="space-y-1">
                    {failedRules.map((rule) => (
                      <li
                        key={rule.code}
                        className="text-[11px] p-2 rounded-lg bg-amber-50 dark:bg-amber-950/35 border border-amber-200/80 dark:border-amber-800/40 text-amber-900 dark:text-amber-200"
                      >
                        <p className="font-semibold">{rule.label}</p>
                        <p className="text-[10px] opacity-90">{rule.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* PANEL B: EDITABLE ALTERNATIVE CONDITIONS */}
            <div className="lg:col-span-7 rounded-xl border border-[#0066FF]/25 dark:border-[#00D1FF]/25 bg-sky-50/30 dark:bg-[#091834] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#0052CC] dark:text-[#00D1FF]">
                  Panel B · Condiciones Alternativas
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  Equivalente aprox.: <strong className="font-mono">{equivalentAltMonths} meses</strong>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Monto Alternativo ({application.currency})
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={altAmount}
                    onChange={(e) => setAltAmount(e.target.value)}
                    className="w-full axy-input px-2.5 py-1.5 font-mono text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Frecuencia de Pago
                  </label>
                  <select
                    value={altFrequency}
                    onChange={(e) => {
                      const nextFreq = e.target.value as PaymentFrequency;
                      const currentMonths = computeEquivalentMonthsFromInstallments(
                        Math.max(1, Math.round(Number(altInstallments) || 1)),
                        altFrequency
                      );
                      setAltFrequency(nextFreq);
                      setAltInstallments(
                        String(computeInstallmentCountFromMonths(currentMonths, nextFreq))
                      );
                    }}
                    className="w-full axy-input px-2.5 py-1.5 text-slate-900 dark:text-white"
                  >
                    <option value="DIARIA">Diaria (÷30)</option>
                    <option value="SEMANAL">Semanal (÷4)</option>
                    <option value="QUINCENAL">Quincenal (÷2)</option>
                    <option value="MENSUAL">Mensual (÷1)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Cantidad de Cuotas
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={360}
                    value={altInstallments}
                    onChange={(e) => setAltInstallments(e.target.value)}
                    className="w-full axy-input px-2.5 py-1.5 font-mono text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Modalidad de Interés
                  </label>
                  <select
                    value={altModality}
                    onChange={(e) => setAltModality(e.target.value as AmortizationMethod)}
                    className="w-full axy-input px-2.5 py-1.5 text-slate-900 dark:text-white"
                  >
                    <option value="SALDO_INSOLUTO">Saldo Insoluto (Francés)</option>
                    <option value="INTERES_FIJO">Interés Fijo (Flat)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Aplicación Gastos Legales
                  </label>
                  <select
                    value={altLegalFeeMode}
                    onChange={(e) => setAltLegalFeeMode(e.target.value as LegalFeeApplicationMode)}
                    className="w-full axy-input px-2.5 py-1.5 text-slate-900 dark:text-white"
                  >
                    <option value="DESCONTAR_DESEMBOLSO">Descontar del desembolso</option>
                    <option value="FINANCIAR">Financiar dentro del capital</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Cuotas Iniciales Solo Interés
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, (Number(altInstallments) || 1) - 1)}
                    value={altInterestOnly}
                    onChange={(e) => setAltInterestOnly(e.target.value)}
                    className="w-full axy-input px-2.5 py-1.5 font-mono text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Fecha Base Desembolso
                  </label>
                  <input
                    type="date"
                    value={altDisbursementDate}
                    onChange={(e) => setAltDisbursementDate(e.target.value)}
                    className="w-full axy-input px-2.5 py-1.5 font-mono text-slate-900 dark:text-white"
                  />
                </div>

                {/* Role-gated pricing overrides */}
                <div className="sm:col-span-2 p-2.5 rounded-xl bg-white/80 dark:bg-[#050E21] border border-slate-200/80 dark:border-white/10 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                      Parámetros de Tasa, Gastos y Cambio
                    </span>
                    {!canOverridePricing && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                        Solo roles autorizados (Analista/Riesgos/Admin)
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400 mb-1">
                        <input
                          type="checkbox"
                          disabled={!canOverridePricing}
                          checked={useSuggestedRate}
                          onChange={(e) => setUseSuggestedRate(e.target.checked)}
                        />
                        Usar tasa sugerida
                      </label>
                      <input
                        type="number"
                        step="0.05"
                        disabled={!canOverridePricing || useSuggestedRate}
                        value={customRatePct}
                        onChange={(e) => setCustomRatePct(e.target.value)}
                        placeholder="Tasa % mensual"
                        className="w-full axy-input px-2 py-1 font-mono text-xs disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-1">
                        Gasto Legal Manual (opc.)
                      </label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canOverridePricing}
                        value={customLegalFees}
                        onChange={(e) => setCustomLegalFees(e.target.value)}
                        placeholder="Auto por tabla"
                        className="w-full axy-input px-2 py-1 font-mono text-xs disabled:opacity-50"
                      />
                    </div>
                    {application.currency === 'USD' && (
                      <div>
                        <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-1">
                          Tasa USD/DOP Manual (opc.)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          disabled={!canOverridePricing}
                          value={manualFx}
                          onChange={(e) => setManualFx(e.target.value)}
                          placeholder="Auto BCRD Venta"
                          className="w-full axy-input px-2 py-1 font-mono text-xs disabled:opacity-50"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Mandatory Justification */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Justificación de Reevaluación (obligatoria para enviar a Evaluación, mín. 10 caracteres)
                </label>
                <textarea
                  rows={2}
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="Ej.: Cliente acepta reducción de monto y ajuste a 18 cuotas mensuales para mantener cuota dentro de su capacidad verificada..."
                  className="w-full axy-input px-3 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>

              {/* Action Buttons + Strict Prerequisite Checklist */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/80 dark:border-white/10">
                <button
                  type="button"
                  disabled={reevalBusy || sendingToEval}
                  onClick={handleRecalculateHumanReeval}
                  className="axy-btn-secondary inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-[#0052CC] dark:text-[#00D1FF] cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${reevalBusy ? 'animate-spin' : ''}`} />
                  <span>{reevalBusy ? 'Calculando...' : 'Recalcular y Guardar Versión'}</span>
                </button>

                <button
                  type="button"
                  disabled={!canClickSendToEvaluation}
                  onClick={handleSendToEvaluation}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{sendingToEval ? 'Enviando...' : 'ENVIAR A EVALUACIÓN'}</span>
                </button>
              </div>

              {sendBlockedChecklist.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/40 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    Requisitos pendientes para habilitar «ENVIAR A EVALUACIÓN»:
                  </p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {sendBlockedChecklist.map((reason, idx) => (
                      <li key={idx}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MAIN PERSISTED FINANCIAL ANALYSIS CONTENT */}
      {selectedAnalysis && calcCond && (
        <>
          {/* Comparative Original vs Active Conditions Strip */}
          {originalSnapshot && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200/80 dark:border-white/10 bg-white dark:bg-[#08132B] p-4 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Condiciones Solicitadas Originalmente (Inmutable)
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Monto:</span>{' '}
                    <strong className="font-mono text-slate-900 dark:text-white">
                      {formatMoney(originalSnapshot.requestedAmount, originalSnapshot.currency)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Plazo / Cuotas:</span>{' '}
                    <strong className="font-mono text-slate-900 dark:text-white">
                      {originalSnapshot.termMonths}m ({originalSnapshot.installmentCount} cuotas)
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Frecuencia:</span>{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {PAYMENT_FREQUENCY_LABELS[originalSnapshot.paymentFrequency]}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Modalidad:</span>{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {AMORTIZATION_METHOD_LABELS[originalSnapshot.amortizationMethod]}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#0066FF]/25 dark:border-[#00D1FF]/25 bg-sky-50/40 dark:bg-[#091834] p-4 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#0052CC] dark:text-[#00D1FF]">
                  Condiciones de Esta Versión (v{selectedAnalysis.version} ·{' '}
                  {ANALYSIS_TYPE_LABELS[selectedAnalysis.analysisType]})
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Monto Evaluado:</span>{' '}
                    <strong className="font-mono text-slate-900 dark:text-white">
                      {formatMoney(calcCond.requestedAmount, calcCond.currency)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Cuotas / Plazo:</span>{' '}
                    <strong className="font-mono text-slate-900 dark:text-white">
                      {calcCond.installmentCount} cuotas ({calcCond.termMonths}m)
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Frecuencia:</span>{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {PAYMENT_FREQUENCY_LABELS[calcCond.paymentFrequency]}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Modalidad:</span>{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {AMORTIZATION_METHOD_LABELS[calcCond.amortizationMethod]}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Complete Financial Summary KPIs */}
          {fin && (
            <div className="rounded-2xl border border-slate-200/85 dark:border-[#00B8FF]/18 bg-white dark:bg-[#08132B] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Resumen Financiero Calculado ({fin.currency})
                </h4>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  ID: {selectedAnalysis.id}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {[
                  {
                    label: 'Monto Solicitado',
                    value: formatMoney(fin.requestedAmount, fin.currency),
                    sub: 'Base para cálculo de gastos legales',
                  },
                  {
                    label: 'Gastos Legales',
                    value: formatMoney(fin.legalFeesAmount, fin.currency),
                    sub: LEGAL_FEE_MODE_LABELS[fin.legalFeeMode],
                  },
                  {
                    label: 'Capital Financiado',
                    value: formatMoney(fin.financedPrincipal, fin.currency),
                    sub:
                      fin.legalFeeMode === 'FINANCIAR'
                        ? 'Incluye gastos legales'
                        : 'Igual al monto solicitado',
                  },
                  {
                    label: 'Monto Neto a Entregar',
                    value: formatMoney(fin.netDisbursementAmount, fin.currency),
                    sub:
                      fin.legalFeeMode === 'DESCONTAR_DESEMBOLSO'
                        ? 'Neto tras descontar gastos'
                        : 'Desembolso íntegro',
                    accent: true,
                  },
                  {
                    label: 'Tasa Mensual / Periódica',
                    value: `${fin.monthlyRatePct.toFixed(2)}% / ${fin.periodicRatePct.toFixed(4)}%`,
                    sub:
                      calcCond.rateSource === 'PERSONALIZADA'
                        ? 'Personalizada autorizada'
                        : calcCond.rateSource === 'MOTOR_V2_BANDA'
                        ? 'Política Motor V2'
                        : 'Sugerida por escala',
                  },
                  {
                    label: 'Cuota Inicial → Final',
                    value: `${formatMoney(fin.initialInstallment, fin.currency)}`,
                    sub: !fin.equalInstallments
                      ? `Final: ${formatMoney(fin.finalInstallment, fin.currency)}`
                      : `Uniforme (${fin.installmentCount} cuotas)`,
                  },
                  {
                    label: 'Total Intereses',
                    value: formatMoney(fin.totalInterest, fin.currency),
                    sub: `Costo total: ${formatMoney(fin.totalCostIncludingFees, fin.currency)}`,
                  },
                  {
                    label: 'Total a Pagar',
                    value: formatMoney(fin.totalPayable, fin.currency),
                    sub: `${formatDateShort(fin.firstDueDate)} → ${formatDateShort(
                      fin.lastDueDate
                    )}`,
                    accent: true,
                  },
                ].map((card) => (
                  <div
                    key={card.label}
                    className={`p-3 rounded-xl border ${
                      card.accent
                        ? 'bg-sky-50/60 dark:bg-[#0066FF]/10 border-sky-200/80 dark:border-[#00D1FF]/30'
                        : 'bg-slate-50/70 dark:bg-[#050E21] border-slate-200/75 dark:border-white/10'
                    }`}
                  >
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{card.label}</p>
                    <p className="text-sm font-mono font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">
                      {card.value}
                    </p>
                    <p
                      className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate"
                      title={card.sub}
                    >
                      {card.sub}
                    </p>
                  </div>
                ))}
              </div>

              {fin.interestOnlyPeriods > 0 && (
                <div className="px-3.5 py-2 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/35 border border-indigo-200/70 dark:border-indigo-800/40 text-xs text-indigo-900 dark:text-indigo-200 flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0" />
                  <span>
                    Esquema especial activo: <strong>{fin.interestOnlyPeriods}</strong> cuota(s) inicial(es) de solo intereses +{' '}
                    <strong>{fin.amortizationPeriods}</strong> cuota(s) de amortización normal.
                  </span>
                </div>
              )}

              {/* USD BCRD Exchange Rate Audit & Referential DOP Block */}
              {fin.currency === 'USD' && selectedAnalysis.exchangeRateMeta && (
                <div className="p-4 rounded-xl border border-amber-200/80 dark:border-amber-700/40 bg-amber-50/50 dark:bg-amber-950/20 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-amber-950 dark:text-amber-200">
                        Tasa de Cambio USD/DOP Aplicada (Solo Referencial) — Venta RD${' '}
                        <span className="font-mono">
                          {selectedAnalysis.exchangeRateMeta.sellRate.toFixed(4)}
                        </span>
                      </p>
                      <p className="text-[11px] text-amber-800 dark:text-amber-300/90">
                        Fuente: {selectedAnalysis.exchangeRateMeta.source} · Fecha tasa:{' '}
                        {selectedAnalysis.exchangeRateMeta.rateDate} ·{' '}
                        {selectedAnalysis.exchangeRateMeta.isAutomaticBcrd
                          ? 'BCRD Automática'
                          : selectedAnalysis.exchangeRateMeta.isFallback
                          ? 'Respaldo parametrizado'
                          : 'Manual autorizada'}
                        {selectedAnalysis.exchangeRateMeta.manualOverrideByName
                          ? ` · Por ${selectedAnalysis.exchangeRateMeta.manualOverrideByName}`
                          : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowDopEquivalent((v) => !v)}
                      className="px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-[#08132B] text-amber-900 dark:text-amber-200 text-xs font-semibold cursor-pointer"
                    >
                      {showDopEquivalent ? 'Ocultar Ref. DOP en tabla' : 'Mostrar Ref. DOP en tabla'}
                    </button>
                  </div>
                  <p className="text-[11px] font-medium text-amber-900 dark:text-amber-300">
                    Equivalente referencial en DOP — la deuda se administra y contabiliza exclusivamente en USD.
                    {fin.dopEquivalentSummary && (
                      <span className="font-mono ml-1.5">
                        Total Ref.: {formatMoney(fin.dopEquivalentSummary.totalPayable, 'DOP')} · Cuota Ref.:{' '}
                        {formatMoney(fin.dopEquivalentSummary.initialInstallment, 'DOP')}
                      </span>
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Rules Evaluated Accordion */}
          <div className="rounded-2xl border border-slate-200/85 dark:border-[#00B8FF]/18 bg-white dark:bg-[#08132B] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowRulesDetails((v) => !v)}
              className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50/70 dark:hover:bg-white/[0.02] cursor-pointer"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                <ShieldCheck className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                <span>
                  Reglas de Elegibilidad Evaluadas ({passedRules.length} cumplidas · {failedRules.length} incumplidas)
                </span>
              </div>
              {showRulesDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showRulesDetails && (
              <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5 border-t border-slate-200/70 dark:border-white/10 pt-3">
                {allRules.map((rule) => (
                  <div
                    key={rule.code}
                    className={`p-2.5 rounded-xl border text-xs flex items-start gap-2 ${
                      rule.passed
                        ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/70 dark:border-emerald-800/40'
                        : 'bg-rose-50/60 dark:bg-rose-950/25 border-rose-200/80 dark:border-rose-800/45'
                    }`}
                  >
                    {rule.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white">{rule.label}</p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">{rule.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Persisted Amortization Schedule Table */}
          {fin && (
            <div className="rounded-2xl border border-slate-200/85 dark:border-[#00B8FF]/18 bg-white dark:bg-[#08132B] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                    Tabla de Amortización Guardada ({selectedAnalysis.installmentsCount} cuotas)
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {loadingInstallments
                      ? 'Cargando detalle completo de cuotas desde Firestore...'
                      : persistedInstallments.length > 0
                      ? `${persistedInstallments.length} cuotas cargadas desde financial_analysis_installments · Capital total: ${formatMoney(
                          fin.totalPrincipal,
                          fin.currency
                        )}`
                      : `Vista previa persistida (${displayRows.length} cuotas)`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {displayRows.length > 24 && (
                    <button
                      type="button"
                      onClick={() => setShowAllInstallments((v) => !v)}
                      className="axy-btn-secondary px-3 py-1.5 text-xs font-semibold cursor-pointer"
                    >
                      {showAllInstallments
                        ? 'Mostrar primeras 24'
                        : `Ver todas (${displayRows.length})`}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    disabled={displayRows.length === 0}
                    className="axy-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Exportar CSV</span>
                  </button>
                </div>
              </div>

              {installmentsError && (
                <div className="px-5 py-2.5 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300 border-b border-amber-200/70">
                  {installmentsError} (Mostrando vista previa guardada en el análisis.)
                </div>
              )}

              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-100/95 dark:bg-[#050E21] text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-white/10">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">#</th>
                      <th className="py-2.5 px-3 font-semibold">Fecha</th>
                      <th className="py-2.5 px-3 font-semibold">Etapa</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Capital</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Interés</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Cuota</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Balance</th>
                      {fin.currency === 'USD' && showDopEquivalent && (
                        <th className="py-2.5 px-3 font-semibold text-right text-amber-700 dark:text-amber-300">
                          Ref. DOP
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-mono tabular-nums">
                    {visibleRows.map((row) => (
                      <tr
                        key={row.installmentNumber}
                        className="hover:bg-slate-50/80 dark:hover:bg-white/[0.03]"
                      >
                        <td className="py-2 px-3 text-slate-500">{row.installmentNumber}</td>
                        <td className="py-2 px-3 text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {formatDateShort(row.dueDate)}
                        </td>
                        <td className="py-2 px-3 font-sans">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              row.stage === 'SOLO_INTERESES'
                                ? 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                                : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {row.stageLabel}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-slate-800 dark:text-slate-200">
                          {formatMoney(row.principal, fin.currency)}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">
                          {formatMoney(row.interest, fin.currency)}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-slate-900 dark:text-white">
                          {formatMoney(row.totalPayment, fin.currency)}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">
                          {formatMoney(row.endingBalance, fin.currency)}
                        </td>
                        {fin.currency === 'USD' && showDopEquivalent && (
                          <td className="py-2 px-3 text-right text-amber-700 dark:text-amber-300">
                            {row.dopEquivalentPayment !== null
                              ? formatMoney(row.dopEquivalentPayment, 'DOP')
                              : '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Decision & Re-evaluation History Timeline */}
          <div className="rounded-2xl border border-slate-200/85 dark:border-[#00B8FF]/18 bg-white dark:bg-[#08132B] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowHistorySection((v) => !v)}
              className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50/70 dark:hover:bg-white/[0.02] cursor-pointer"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                <History className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
                <span>
                  Historial de Versiones y Decisiones ({appAnalyses.length} versiones · {appHistory.length} eventos)
                </span>
              </div>
              {showHistorySection ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showHistorySection && (
              <div className="px-5 pb-4 pt-3 border-t border-slate-200/70 dark:border-white/10 space-y-2.5">
                {appHistory.length === 0 ? (
                  <p className="text-xs text-slate-500">Sin eventos adicionales registrados aún.</p>
                ) : (
                  appHistory.map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3 rounded-xl bg-slate-50/80 dark:bg-[#050E21] border border-slate-200/70 dark:border-white/10 text-xs space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <UserCheck className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
                          {ev.eventType.replace(/_/g, ' ')} · {ev.previousStatus} → {ev.newStatus}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTimestamp(ev.createdAt)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        Responsable: <strong>{ev.actorName}</strong> ({ev.actorRole}) · Reglas:{' '}
                        {ev.rulesPassedCount} cumplidas / {ev.rulesFailedCount} incumplidas
                      </p>
                      {ev.justification && (
                        <p className="text-[11px] italic text-slate-700 dark:text-slate-300">
                          «{ev.justification}»
                        </p>
                      )}
                      {ev.changesSummary.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {ev.changesSummary.map((ch, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded bg-white dark:bg-[#08152E] border border-slate-200 dark:border-white/10 text-[10px] font-mono"
                            >
                              {ch.label}: {ch.before} → {ch.after}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
