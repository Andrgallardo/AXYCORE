import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Calculator,
  CheckCircle2,
  FileCheck2,
  Lock,
  Send,
  Upload,
  UserPlus,
} from 'lucide-react';
import {
  BiometricIdentityVerifier,
  type PendingIdentityFileItem,
} from './BiometricIdentityVerifier';
import { InstitutionalLogoBadge } from './InstitutionalLogoBadge';
import {
  FieldValidationFeedback,
  getValidatedInputClass,
} from './ui/FieldValidationFeedback';
import { OriginationProgressBar } from './ui/OriginationProgressBar';
import {
  ALL_APPLICATION_FIELDS,
  STEP_FIELDS,
  validateApplicationFormFields,
  type ApplicationFieldName,
  type ApplicationFormStep,
} from '../engine/applicationFieldValidation';
import { BIOMETRIC_VERDICT_LABELS } from '../engine/biometricVerification';
import {
  computeIndicativePublicInstallment,
  validatePublicCreditApplicationPayload,
} from '../engine/externalPortalEngine';
import { submitPublicCreditApplication } from '../services/externalPortalService';
import type {
  AdditionalIncomeStatus,
  AmortizationMethod,
  ApplicantType,
  BiometricVerificationResult,
  CurrencyCode,
  DebtDeclarationStatus,
  HousingType,
  IncomeSourceType,
  PaymentFrequency,
  ProductCode,
  PublicCreditApplicationRecord,
  PublicInstitutionPortalRecord,
  SocialMediaStatus,
} from '../types/axycore';
import {
  PRODUCT_LABELS,
  formatMoney,
} from '../utils/formatters';

interface PublicCreditApplicationFormProps {
  portal: PublicInstitutionPortalRecord;
  onSwitchToClientAuth: (
    targetIntent: 'registro' | 'ingresar',
    prefill?: { email?: string; fullName?: string }
  ) => void;
  onSubmitted?: (record: PublicCreditApplicationRecord) => void;
  previewOnly?: boolean;
}

const CONSENT_VERSION = 'v1.0-Ley172-13';
const MAX_PUBLIC_FILE_BYTES = 250 * 1024;
const MAX_TOTAL_PUBLIC_FILE_BYTES = 500 * 1024;

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return dataUrl.length;
  return Math.ceil(((dataUrl.length - commaIdx - 1) * 3) / 4);
}

async function compressPublicImageFile(
  file: File,
  maxBytes: number
): Promise<{ dataUrl: string; sizeBytes: number; mimeType: string; fileName: string } | null> {
  if (typeof document === 'undefined' || !file.type.startsWith('image/')) {
    return null;
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo procesar la imagen seleccionada.'));
      el.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const maxDims = [1280, 960, 720, 540];
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'documento';

    for (const maxDim of maxDims) {
      const ratio = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * ratio));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * ratio));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      for (let quality = 0.82; quality >= 0.42; quality -= 0.1) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const sizeBytes = estimateDataUrlBytes(dataUrl);
        if (sizeBytes <= maxBytes) {
          return {
            dataUrl,
            sizeBytes,
            mimeType: 'image/jpeg',
            fileName: `${baseName}.jpg`,
          };
        }
      }
    }
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function formatPublicSubmissionError(
  err: unknown,
  instName: string,
  instPhone?: string
): string {
  const contactHint = instPhone
    ? ` Si el problema persiste, comunícate con ${instName} al ${instPhone}.`
    : ` Si el problema persiste, comunícate directamente con ${instName}.`;
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();

  // Preserve clear client-side validation or portal-disabled messages
  if (
    raw &&
    !raw.trim().startsWith('{') &&
    !lower.includes('permission') &&
    !lower.includes('firestore') &&
    !lower.includes('public_credit_applications') &&
    !lower.includes('insufficient') &&
    !lower.includes('network') &&
    !lower.includes('unavailable') &&
    !lower.includes('failed-precondition') &&
    !lower.includes('resource-exhausted') &&
    !lower.includes('invalid-argument')
  ) {
    return raw;
  }

  if (lower.includes('unavailable') || lower.includes('network') || lower.includes('offline')) {
    return `No pudimos conectar con el servidor en este momento. Verifica tu conexión a internet e intenta enviar nuevamente.${contactHint}`;
  }

  if (lower.includes('exceeds the maximum allowed size') || lower.includes('resource-exhausted')) {
    return 'Los documentos adjuntos superan el tamaño permitido para envío en línea. Quita o reduce alguno de los archivos en el Paso 4 e intenta nuevamente.';
  }

  return `No pudimos completar el envío de tu solicitud en este momento. Verifica que todos los datos obligatorios estén completos e intenta nuevamente.${contactHint}`;
}

const INPUT_CLASS =
  'w-full px-3 py-2 rounded-lg bg-[#030816]/85 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:border-[#00B8FF] focus:outline-none disabled:opacity-45';
const INPUT_MONO_CLASS = `${INPUT_CLASS} font-mono tabular-nums`;
const LABEL_CLASS = 'block text-xs font-medium text-slate-300 mb-1';

export function PublicCreditApplicationForm({
  portal,
  onSwitchToClientAuth,
  onSubmitted,
  previewOnly = false,
}: PublicCreditApplicationFormProps) {
  const defaultCurrency: CurrencyCode = portal.currency === 'USD' ? 'USD' : 'DOP';
  const instPrimary = portal.primaryColor || '#0f3d91';
  const instAccent = portal.accentColor || '#0284c7';
  const instName = portal.tradeName || portal.name || 'Institución Financiera';

  const topAnchorRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [step, setStep] = useState<ApplicationFormStep>(1);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [touchedFields, setTouchedFields] = useState<Partial<Record<ApplicationFieldName, boolean>>>(
    {}
  );
  const [attemptedSteps, setAttemptedSteps] = useState<
    Partial<Record<ApplicationFormStep, boolean>>
  >({});
  const [submittedRecord, setSubmittedRecord] = useState<PublicCreditApplicationRecord | null>(null);

  // Step 1: Applicant & Personal / Business Info (1:1 parity with NewApplicationView)
  const [applicantType, setApplicantType] = useState<ApplicantType>('INDIVIDUAL');
  const [documentType, setDocumentType] = useState<'CEDULA' | 'PASAPORTE'>('CEDULA');
  const [documentNumber, setDocumentNumber] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [nationality, setNationality] = useState('Dominicana');
  const [maritalStatus, setMaritalStatus] = useState('Soltero/a');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [province, setProvince] = useState('');
  const [residenceMonths, setResidenceMonths] = useState<number>(24);
  const [housingType, setHousingType] = useState<HousingType>('ALQUILADA');
  const [housingPayment, setHousingPayment] = useState<number>(0);
  const [socialMediaDeclared, setSocialMediaDeclared] = useState<SocialMediaStatus>('NO_MEDIA');
  const [socialMediaHandle, setSocialMediaHandle] = useState('');
  const [altContactName, setAltContactName] = useState('');
  const [altContactPhone, setAltContactPhone] = useState('');

  // Business Info (if BUSINESS)
  const [rnc, setRnc] = useState('');
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [companyType, setCompanyType] = useState('SRL');
  const [economicActivity, setEconomicActivity] = useState('');
  const [operationsStartDate, setOperationsStartDate] = useState('');
  const [authorizedRepName, setAuthorizedRepName] = useState('');
  const [authorizedRepDoc, setAuthorizedRepDoc] = useState('');
  const [corporateDocsSummary, setCorporateDocsSummary] = useState('');

  // Step 2: Labor & Financial Data (1:1 parity with NewApplicationView)
  const [activityType, setActivityType] = useState('Empleado privado');
  const [employerOrBusinessName, setEmployerOrBusinessName] = useState('');
  const [occupationOrRole, setOccupationOrRole] = useState('');
  const [employmentMonths, setEmploymentMonths] = useState<number>(24);
  const [incomeSourceType, setIncomeSourceType] = useState<IncomeSourceType>('FIJA_RECURRENTE');
  const [primaryNetIncome, setPrimaryNetIncome] = useState<string>(
    defaultCurrency === 'USD' ? '1500' : '75000'
  );
  const [additionalIncomeStatus, setAdditionalIncomeStatus] =
    useState<AdditionalIncomeStatus>('EXPLICIT_NONE');
  const [additionalNetIncome, setAdditionalNetIncome] = useState<string>('0');
  const [declaredTotalMonthlyIncome, setDeclaredTotalMonthlyIncome] = useState<string>('');
  const [incomeCurrency, setIncomeCurrency] = useState<CurrencyCode>(defaultCurrency);
  const [essentialExpenses, setEssentialExpenses] = useState<string>(
    defaultCurrency === 'USD' ? '600' : '28000'
  );
  const [housingIncludedInExpenses, setHousingIncludedInExpenses] = useState<boolean>(false);

  const [debtDeclarationStatus, setDebtDeclarationStatus] =
    useState<DebtDeclarationStatus>('NO_DEBTS_EXPLICIT');
  const [debtCount, setDebtCount] = useState<string>('0');
  const [totalDebtBalance, setTotalDebtBalance] = useState<string>('0');
  const [currentDebtPayments, setCurrentDebtPayments] = useState<string>('0');
  const [bankDebtPayment, setBankDebtPayment] = useState<string>('0');
  const [financeDebtPayment, setFinanceDebtPayment] = useState<string>('0');
  const [cardDebtPayment, setCardDebtPayment] = useState<string>('0');
  const [informalDebtPayment, setInformalDebtPayment] = useState<string>('0');
  const [otherDebtPayment, setOtherDebtPayment] = useState<string>('0');

  // Business financials
  const [grossSales, setGrossSales] = useState<string>('');
  const [operatingCosts, setOperatingCosts] = useState<string>('');
  const [netMonthlyFlow, setNetMonthlyFlow] = useState<string>('');
  const [repaymentSource, setRepaymentSource] = useState<string>('');

  // Step 3: Requested Conditions (1:1 parity with NewApplicationView)
  const [productCode, setProductCode] = useState<ProductCode>(
    defaultCurrency === 'USD' ? 'PERSONAL_USD' : 'PERSONAL_DOP'
  );
  const [requestedAmount, setRequestedAmount] = useState<string>(
    defaultCurrency === 'USD' ? '2500' : '100000'
  );
  const [requestedTermMonths, setRequestedTermMonths] = useState<string>('12');
  const [paymentFrequency, setPaymentFrequency] = useState<PaymentFrequency>('MENSUAL');
  const [amortizationMethod, setAmortizationMethod] =
    useState<AmortizationMethod>('SALDO_INSOLUTO');
  const [loanPurpose, setLoanPurpose] = useState('Capital / Consumo personal');
  const [loanPurposeDescription, setLoanPurposeDescription] = useState('');
  const [proposedCollateral, setProposedCollateral] = useState('');

  // Step 4: References & Documents (1:1 parity with NewApplicationView)
  const [ref1Name, setRef1Name] = useState('');
  const [ref1Rel, setRef1Rel] = useState('');
  const [ref1Phone, setRef1Phone] = useState('');
  const [ref2Name, setRef2Name] = useState('');
  const [ref2Rel, setRef2Rel] = useState('');
  const [ref2Phone, setRef2Phone] = useState('');
  const [hasIdentityDoc, setHasIdentityDoc] = useState(true);
  const [hasIncomeEvidence, setHasIncomeEvidence] = useState(true);
  const [pendingFiles, setPendingFiles] = useState<PendingIdentityFileItem[]>([]);
  const [biometricResult, setBiometricResult] = useState<BiometricVerificationResult | null>(null);

  // Step 5: Consent
  const [consentAccepted, setConsentAccepted] = useState(false);

  const derivedCurrency: CurrencyCode = productCode.endsWith('USD') ? 'USD' : 'DOP';

  const indicative = useMemo(() => {
    return computeIndicativePublicInstallment({
      amount: Number(requestedAmount) || 0,
      termMonths: Number(requestedTermMonths) || 12,
      frequency: paymentFrequency,
    });
  }, [requestedAmount, requestedTermMonths, paymentFrequency]);

  const parseNumOrNull = (val: string): number | null => {
    if (val.trim() === '') return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  };

  const validation = useMemo(
    () =>
      validateApplicationFormFields({
        applicantType,
        documentType,
        documentNumber,
        birthDate,
        firstName,
        lastName,
        phone,
        email,
        residenceMonths,
        housingPayment,
        socialMediaDeclared,
        socialMediaHandle,
        altContactPhone,
        rnc,
        legalName,
        authorizedRepName,
        authorizedRepDoc,
        operationsStartDate,
        employmentMonths,
        incomeSourceType,
        primaryNetIncome,
        additionalIncomeStatus,
        additionalNetIncome,
        declaredTotalMonthlyIncome,
        grossSales,
        operatingCosts,
        netMonthlyFlow,
        essentialExpenses,
        debtDeclarationStatus,
        debtCount,
        totalDebtBalance,
        currentDebtPayments,
        bankDebtPayment,
        financeDebtPayment,
        cardDebtPayment,
        informalDebtPayment,
        otherDebtPayment,
        currency: derivedCurrency,
        requestedAmount,
        requestedTermMonths,
        loanPurpose,
        ref1Name,
        ref1Rel,
        ref1Phone,
        ref2Name,
        ref2Rel,
        ref2Phone,
        consentAccepted,
      }),
    [
      applicantType,
      documentType,
      documentNumber,
      birthDate,
      firstName,
      lastName,
      phone,
      email,
      residenceMonths,
      housingPayment,
      socialMediaDeclared,
      socialMediaHandle,
      altContactPhone,
      rnc,
      legalName,
      authorizedRepName,
      authorizedRepDoc,
      operationsStartDate,
      employmentMonths,
      incomeSourceType,
      primaryNetIncome,
      additionalIncomeStatus,
      additionalNetIncome,
      declaredTotalMonthlyIncome,
      grossSales,
      operatingCosts,
      netMonthlyFlow,
      essentialExpenses,
      debtDeclarationStatus,
      debtCount,
      totalDebtBalance,
      currentDebtPayments,
      bankDebtPayment,
      financeDebtPayment,
      cardDebtPayment,
      informalDebtPayment,
      otherDebtPayment,
      derivedCurrency,
      requestedAmount,
      requestedTermMonths,
      loanPurpose,
      ref1Name,
      ref1Rel,
      ref1Phone,
      ref2Name,
      ref2Rel,
      ref2Phone,
      consentAccepted,
    ]
  );

  const markTouched = (field: ApplicationFieldName) => {
    setTouchedFields((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  };

  const markStepTouched = (targetStep: ApplicationFormStep) => {
    setAttemptedSteps((prev) => ({ ...prev, [targetStep]: true }));
    setTouchedFields((prev) => {
      const next = { ...prev };
      for (const f of STEP_FIELDS[targetStep]) next[f] = true;
      return next;
    });
  };

  const markAllTouched = () => {
    setAttemptedSteps({ 1: true, 2: true, 3: true, 4: true, 5: true });
    const all: Partial<Record<ApplicationFieldName, boolean>> = {};
    for (const f of ALL_APPLICATION_FIELDS) all[f] = true;
    setTouchedFields(all);
  };

  const focusField = (field?: ApplicationFieldName) => {
    if (!field || typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      const el = formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
      }
    });
  };

  const getFieldError = (field: ApplicationFieldName): string | undefined =>
    touchedFields[field] ? validation.errors[field] : undefined;

  const getFieldWarning = (field: ApplicationFieldName): string | undefined =>
    touchedFields[field] && !validation.errors[field] ? validation.warnings[field] : undefined;

  const fieldInputClass = (
    field: ApplicationFieldName,
    baseClass: string,
    hasValue: boolean
  ): string => {
    const err = getFieldError(field);
    if (err) return getValidatedInputClass(baseClass, 'error', 'dark');
    const warn = getFieldWarning(field);
    if (warn) return getValidatedInputClass(baseClass, 'warning', 'dark');
    if (touchedFields[field] && hasValue) {
      return getValidatedInputClass(baseClass, 'valid', 'dark');
    }
    return baseClass;
  };

  const goToStep = (nextStep: ApplicationFormStep) => {
    setErrorMsg(null);
    setStep(nextStep);
    topAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const handleNextStep = () => {
    setErrorMsg(null);
    markStepTouched(step);
    const errCount = validation.stepErrorCounts[step];
    if (errCount > 0) {
      const firstField = validation.firstInvalidFieldByStep[step];
      setErrorMsg(
        errCount === 1
          ? 'Corrige el campo señalado en este paso antes de continuar.'
          : `Corrige los ${errCount} campos señalados en este paso antes de continuar.`
      );
      focusField(firstField);
      return;
    }
    goToStep((step + 1) as ApplicationFormStep);
  };

  const handleFileAttach = async (category: string, file: File | null) => {
    if (!file) return;
    setErrorMsg(null);
    if (pendingFiles.length >= 3) {
      setErrorMsg('Puedes adjuntar hasta 3 archivos en la solicitud pública. Quita uno para reemplazarlo.');
      return;
    }

    const currentTotal = pendingFiles.reduce((acc, item) => acc + item.sizeBytes, 0);
    const remainingBudget = MAX_TOTAL_PUBLIC_FILE_BYTES - currentTotal;
    const targetLimit = Math.min(MAX_PUBLIC_FILE_BYTES, remainingBudget);

    if (targetLimit < 20 * 1024) {
      setErrorMsg('El tamaño combinado de los archivos adjuntos no debe superar 500 KB. Quita un archivo para agregar otro.');
      return;
    }

    // Auto-compress oversized phone camera photos (JPG/PNG/WEBP) so mobile prospects don't hit the 250 KB wall
    if (file.size > targetLimit && file.type.startsWith('image/')) {
      try {
        const compressed = await compressPublicImageFile(file, Math.min(235 * 1024, targetLimit));
        if (compressed) {
          setPendingFiles((prev) => [
            ...prev,
            {
              category,
              fileName: compressed.fileName,
              mimeType: compressed.mimeType,
              sizeBytes: compressed.sizeBytes,
              fileDataUrl: compressed.dataUrl,
            },
          ]);
          if (category === 'Identidad') setHasIdentityDoc(true);
          if (category === 'Ingresos') setHasIncomeEvidence(true);
          return;
        }
      } catch {
        // Fall through to standard size validation message
      }
    }

    if (file.size > MAX_PUBLIC_FILE_BYTES) {
      setErrorMsg(
        'Para envío público seguro, cada archivo no debe superar 250 KB. Comprime la imagen o PDF e intenta nuevamente.'
      );
      return;
    }
    if (currentTotal + file.size > MAX_TOTAL_PUBLIC_FILE_BYTES) {
      setErrorMsg('El tamaño combinado de los archivos adjuntos no debe superar 500 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      setPendingFiles((prev) => [
        ...prev,
        {
          category,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          fileDataUrl: dataUrl,
        },
      ]);
      if (category === 'Identidad') setHasIdentityDoc(true);
      if (category === 'Ingresos') setHasIncomeEvidence(true);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveBiometricCapture = (capture: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    fileDataUrl: string;
    notes: string;
    result: BiometricVerificationResult;
  }) => {
    setBiometricResult(capture.result);
    if (capture.sizeBytes <= MAX_PUBLIC_FILE_BYTES) {
      setPendingFiles((prev) => {
        const filtered = prev.filter((f) => f.category !== 'Verificacion_Biometrica');
        if (filtered.length >= 3) return filtered;
        return [
          ...filtered,
          {
            category: 'Verificacion_Biometrica',
            fileName: capture.fileName,
            mimeType: capture.mimeType,
            sizeBytes: capture.sizeBytes,
            fileDataUrl: capture.fileDataUrl,
            notes: capture.notes,
          },
        ];
      });
    }
    if (capture.result.verdict === 'COINCIDE') {
      setHasIdentityDoc(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 5) {
      handleNextStep();
      return;
    }
    setErrorMsg(null);
    markAllTouched();

    if (!validation.isFormValid && validation.firstInvalidStep) {
      const targetStep = validation.firstInvalidStep;
      const firstField = validation.firstInvalidFieldByStep[targetStep];
      const totalErrors = Object.keys(validation.errors).length;
      setStep(targetStep);
      setErrorMsg(
        totalErrors === 1
          ? 'Hay 1 campo incompleto o con formato incorrecto. Revísalo antes de enviar.'
          : `Hay ${totalErrors} campos incompletos o con formato incorrecto. Revisa los campos señalados antes de enviar.`
      );
      focusField(firstField);
      return;
    }

    const references = [
      ref1Name.trim() || ref1Phone.trim()
        ? { name: ref1Name.trim(), relationship: ref1Rel.trim(), phone: ref1Phone.trim() }
        : null,
      ref2Name.trim() || ref2Phone.trim()
        ? { name: ref2Name.trim(), relationship: ref2Rel.trim(), phone: ref2Phone.trim() }
        : null,
    ].filter((r): r is NonNullable<typeof r> => r !== null);

    const displayName =
      applicantType === 'BUSINESS' && (tradeName.trim() || legalName.trim())
        ? `${tradeName.trim() || legalName.trim()} (${firstName.trim()} ${lastName.trim()})`
        : `${firstName.trim()} ${lastName.trim()}`.trim();

    const parsedPrimaryIncome = Number(primaryNetIncome) || 0;
    const parsedAdditionalIncome =
      additionalIncomeStatus === 'EXPLICIT_NONE' ? 0 : Number(additionalNetIncome) || 0;
    const parsedBizFlow = Number(netMonthlyFlow) || 0;
    const summaryMonthlyIncome =
      applicantType === 'BUSINESS' && parsedBizFlow > 0
        ? parsedBizFlow
        : parsedPrimaryIncome + parsedAdditionalIncome;

    const payload = {
      applicantType,
      applicantFullName: displayName,
      documentType,
      documentNumber: documentNumber.trim(),
      phone: phone.trim(),
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      province: province.trim() || municipality.trim() || undefined,
      productCode,
      currency: derivedCurrency,
      requestedAmount: Number(requestedAmount),
      requestedTermMonths: Number(requestedTermMonths),
      paymentFrequency,
      amortizationMethod,
      loanPurpose: loanPurpose.trim(),
      loanPurposeDescription: loanPurposeDescription.trim() || undefined,
      proposedCollateral: proposedCollateral.trim() || undefined,
      monthlyIncome: summaryMonthlyIncome,
      monthlyExpenses: Number(essentialExpenses || 0),
      employerOrActivity: employerOrBusinessName.trim() || activityType.trim() || undefined,
      customerDetails: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...(birthDate ? { birthDate } : {}),
        ...(nationality.trim() ? { nationality: nationality.trim() } : {}),
        ...(maritalStatus.trim() ? { maritalStatus: maritalStatus.trim() } : {}),
        ...(municipality.trim() ? { municipality: municipality.trim() } : {}),
        residenceMonths: Number(residenceMonths) || 0,
        housingType,
        housingPayment: Number(housingPayment) || 0,
        socialMediaDeclared,
        ...(socialMediaDeclared === 'YES' && socialMediaHandle.trim()
          ? { socialMediaHandle: socialMediaHandle.trim() }
          : {}),
        ...(altContactName.trim() ? { altContactName: altContactName.trim() } : {}),
        ...(altContactPhone.trim() ? { altContactPhone: altContactPhone.trim() } : {}),
      },
      businessDetails:
        applicantType === 'BUSINESS'
          ? {
              rnc: rnc.trim(),
              legalName: legalName.trim(),
              ...(tradeName.trim() ? { tradeName: tradeName.trim() } : {}),
              ...(companyType.trim() ? { companyType: companyType.trim() } : {}),
              ...(economicActivity.trim() ? { economicActivity: economicActivity.trim() } : {}),
              ...(operationsStartDate ? { operationsStartDate } : {}),
              authorizedRepName: authorizedRepName.trim(),
              ...(authorizedRepDoc.trim() ? { authorizedRepDoc: authorizedRepDoc.trim() } : {}),
              ...(corporateDocsSummary.trim()
                ? { corporateDocsSummary: corporateDocsSummary.trim() }
                : {}),
            }
          : null,
      financialData: {
        activityType: activityType.trim(),
        employerOrBusinessName: employerOrBusinessName.trim(),
        occupationOrRole: occupationOrRole.trim(),
        employmentMonths: Number(employmentMonths) || 0,
        incomeSourceType,
        primaryNetIncome: parseNumOrNull(primaryNetIncome),
        additionalIncomeStatus,
        additionalNetIncome: parseNumOrNull(additionalNetIncome) ?? 0,
        declaredTotalMonthlyIncome: parseNumOrNull(declaredTotalMonthlyIncome),
        incomeCurrency,
        essentialExpenses: parseNumOrNull(essentialExpenses),
        housingPayment: Number(housingPayment) || 0,
        housingIncludedInExpenses,
        debtDeclarationStatus,
        debtCount: parseNumOrNull(debtCount),
        totalDebtBalance: parseNumOrNull(totalDebtBalance),
        currentDebtPayments: parseNumOrNull(currentDebtPayments),
        bankDebtPayment: parseNumOrNull(bankDebtPayment),
        financeDebtPayment: parseNumOrNull(financeDebtPayment),
        cardDebtPayment: parseNumOrNull(cardDebtPayment),
        informalDebtPayment: parseNumOrNull(informalDebtPayment),
        otherDebtPayment: parseNumOrNull(otherDebtPayment),
      },
      businessFinancialData:
        applicantType === 'BUSINESS'
          ? {
              grossSales: parseNumOrNull(grossSales),
              operatingCosts: parseNumOrNull(operatingCosts),
              netMonthlyFlow: parseNumOrNull(netMonthlyFlow),
              businessObligationsMonthly: parseNumOrNull(currentDebtPayments),
              totalBusinessDebtBalance: parseNumOrNull(totalDebtBalance),
              businessDebtCount: parseNumOrNull(debtCount),
              repaymentSource: repaymentSource.trim(),
              operationsMonths: Number(employmentMonths) || 0,
              incomeCurrency,
              debtDeclarationStatus,
            }
          : null,
      references,
      declaredDocumentsSummary: {
        hasIdentityDoc,
        hasIncomeEvidence,
      },
      attachedDocuments: pendingFiles,
      biometricSummary: biometricResult
        ? {
            verdict: biometricResult.verdict,
            similarityScore: biometricResult.similarityScore,
            livenessAssessment: biometricResult.livenessAssessment,
            summary: biometricResult.comparisonRationale,
          }
        : null,
      consentVersion: CONSENT_VERSION,
      consentAccepted,
    };

    const check = validatePublicCreditApplicationPayload(payload);
    if (!check.valid) {
      setErrorMsg(check.errors[0] || 'Por favor verifica los datos ingresados.');
      return;
    }

    if (previewOnly) {
      setErrorMsg(
        'Modo Vista Previa activo: usa "Probar Enlace Real Ahora" para enviar una solicitud real a la cola de la institución.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const saved = await submitPublicCreditApplication({
        portal,
        input: payload,
      });
      setSubmittedRecord(saved);
      onSubmitted?.(saved);
    } catch (err) {
      setErrorMsg(formatPublicSubmissionError(err, instName, portal.phone));
    } finally {
      setSubmitting(false);
    }
  };

  const resetForNewApplication = () => {
    setSubmittedRecord(null);
    setErrorMsg(null);
    setConsentAccepted(false);
    setPendingFiles([]);
    setBiometricResult(null);
    setTouchedFields({});
    setAttemptedSteps({});
    setStep(1);
  };

  if (submittedRecord) {
    return (
      <div className="space-y-5">
        <div className="p-5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 space-y-3.5">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-emerald-500/20">
            <div className="flex items-center gap-2.5 min-w-0">
              <InstitutionalLogoBadge
                logoUrl={portal.logoUrl}
                name={instName}
                primaryColor={instPrimary}
                accentColor={instAccent}
                size="sm"
              />
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">{instName}</p>
                <p className="text-[11px] text-emerald-200/80 font-mono truncate">
                  Portal {portal.portalCode}
                  {portal.phone ? ` · Tel. ${portal.phone}` : ''}
                </p>
              </div>
            </div>
            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
          </div>
          <div className="space-y-1">
            <h3 className="font-display text-lg font-bold text-white">
              Solicitud recibida correctamente
            </h3>
            <p className="text-xs text-emerald-100/90 leading-relaxed">
              Tu expediente completo fue enviado de forma privada y exclusiva a{' '}
              <strong className="text-white">{instName}</strong>. Nuestro equipo de crédito
              procesará tu solicitud con el Motor de Decisiones y te contactará pronto.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-emerald-500/20 text-xs">
            <div>
              <span className="text-slate-400 block text-[11px]">Número de Seguimiento</span>
              <span className="font-mono font-bold text-base text-white tabular-nums">
                {submittedRecord.trackingNumber}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Solicitante</span>
              <span className="font-semibold text-white block truncate">
                {submittedRecord.applicantFullName}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Monto y Plazo Solicitado</span>
              <span className="font-mono font-semibold text-white tabular-nums">
                {formatMoney(submittedRecord.requestedAmount, submittedRecord.currency)} ·{' '}
                {submittedRecord.requestedTermMonths} meses ({submittedRecord.paymentFrequency})
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Cuota Estimada Referencial</span>
              <span className="font-mono font-semibold text-emerald-300 tabular-nums">
                {formatMoney(submittedRecord.indicativeInstallment, submittedRecord.currency)}
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-white/12 bg-white/[0.03] space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-white">
              ¿Deseas crear tu cuenta de cliente en {instName}?
            </p>
            <p className="text-xs text-slate-400 leading-relaxed">
              Con tu usuario podrás consultar tus préstamos aprobados, ver tu calendario de cuotas,
              reportar pagos y solicitar cartas de saldo en cualquier momento.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() =>
                onSwitchToClientAuth('registro', {
                  email: submittedRecord.email,
                  fullName: `${firstName} ${lastName}`.trim() || submittedRecord.applicantFullName,
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs font-semibold cursor-pointer hover:brightness-110 transition-all whitespace-nowrap"
              style={{
                background: `linear-gradient(135deg, ${instPrimary}, ${instAccent})`,
              }}
            >
              <UserPlus className="w-4 h-4" />
              <span>Crear mi cuenta de cliente</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={resetForNewApplication}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap"
            >
              Crear otra solicitud
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} noValidate onSubmit={handleSubmit} className="space-y-5">
      <div ref={topAnchorRef} />

      {/* Institutional Identity Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <InstitutionalLogoBadge
            logoUrl={portal.logoUrl}
            name={instName}
            primaryColor={instPrimary}
            accentColor={instAccent}
            size="md"
          />
          <div className="min-w-0">
            <p className="text-xs font-bold text-white truncate">{instName}</p>
            <p className="text-[11px] text-slate-400 truncate">
              Solicitud Oficial de Crédito · Código {portal.portalCode}
              {portal.phone ? ` · Tel. ${portal.phone}` : ''}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-300 shrink-0">
          <Lock className="w-3.5 h-3.5" />
          <span>Envío privado y encriptado</span>
        </span>
      </div>

      {/* Visual Origination Progress Bar + Interactive 5-Step Milestones */}
      <OriginationProgressBar
        currentStep={step}
        stepValid={validation.stepValid}
        stepErrorCounts={validation.stepErrorCounts}
        attemptedSteps={attemptedSteps}
        onSelectStep={goToStep}
        variant="dark"
        primaryColor={instPrimary}
        accentColor={instAccent}
      />

      {errorMsg && (
        <div
          role="alert"
          className="p-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs text-rose-200 flex items-start gap-2 overflow-hidden"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="min-w-0 flex-1 break-words leading-relaxed">{errorMsg}</span>
        </div>
      )}

      {/* ==================== STEP 1: SOLICITANTE ==================== */}
      {step === 1 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="pub-applicant-type" className={LABEL_CLASS}>
                Tipo de Solicitud
              </label>
              <select
                id="pub-applicant-type"
                value={applicantType}
                onChange={(e) => {
                  const t = e.target.value as ApplicantType;
                  setApplicantType(t);
                  setProductCode(
                    t === 'BUSINESS'
                      ? derivedCurrency === 'USD'
                        ? 'EMPRESARIAL_USD'
                        : 'EMPRESARIAL_DOP'
                      : derivedCurrency === 'USD'
                      ? 'PERSONAL_USD'
                      : 'PERSONAL_DOP'
                  );
                }}
                className={INPUT_CLASS}
              >
                <option value="INDIVIDUAL">Persona Física (Individual)</option>
                <option value="BUSINESS">Persona Jurídica / Empresa</option>
              </select>
            </div>
            <div>
              <label htmlFor="pub-doctype" className={LABEL_CLASS}>
                Tipo Documento *
              </label>
              <select
                id="pub-doctype"
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value as 'CEDULA' | 'PASAPORTE')}
                className={INPUT_CLASS}
              >
                <option value="CEDULA">Cédula</option>
                <option value="PASAPORTE">Pasaporte</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label htmlFor="pub-docnum" className={LABEL_CLASS}>
                Número de Documento *
              </label>
              <input
                id="pub-docnum"
                data-field="documentNumber"
                type="text"
                maxLength={40}
                value={documentNumber}
                onChange={(e) => {
                  setDocumentNumber(e.target.value);
                  markTouched('documentNumber');
                }}
                onBlur={() => markTouched('documentNumber')}
                aria-invalid={Boolean(getFieldError('documentNumber'))}
                placeholder={documentType === 'CEDULA' ? '001-0000000-0' : 'AA1234567'}
                className={fieldInputClass(
                  'documentNumber',
                  INPUT_MONO_CLASS,
                  Boolean(documentNumber.trim())
                )}
              />
              <FieldValidationFeedback
                variant="dark"
                error={getFieldError('documentNumber')}
                validHint={
                  touchedFields.documentNumber &&
                  !validation.errors.documentNumber &&
                  documentNumber.trim()
                    ? documentType === 'CEDULA'
                      ? 'Cédula válida (11 dígitos)'
                      : 'Pasaporte válido'
                    : undefined
                }
              />
            </div>
            <div>
              <label htmlFor="pub-birthdate" className={LABEL_CLASS}>
                Fecha de Nacimiento
              </label>
              <input
                id="pub-birthdate"
                data-field="birthDate"
                type="date"
                value={birthDate}
                onChange={(e) => {
                  setBirthDate(e.target.value);
                  markTouched('birthDate');
                }}
                onBlur={() => markTouched('birthDate')}
                aria-invalid={Boolean(getFieldError('birthDate'))}
                className={fieldInputClass('birthDate', INPUT_CLASS, Boolean(birthDate.trim()))}
              />
              <FieldValidationFeedback variant="dark" error={getFieldError('birthDate')} />
            </div>
            <div>
              <label htmlFor="pub-phone" className={LABEL_CLASS}>
                Teléfono Principal *
              </label>
              <input
                id="pub-phone"
                data-field="phone"
                type="tel"
                maxLength={40}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  markTouched('phone');
                }}
                onBlur={() => markTouched('phone')}
                aria-invalid={Boolean(getFieldError('phone'))}
                placeholder="809-555-0000"
                className={fieldInputClass('phone', INPUT_MONO_CLASS, Boolean(phone.trim()))}
              />
              <FieldValidationFeedback
                variant="dark"
                error={getFieldError('phone')}
                validHint={
                  touchedFields.phone && !validation.errors.phone && phone.trim()
                    ? 'Teléfono válido'
                    : undefined
                }
              />
            </div>
            <div>
              <label htmlFor="pub-firstname" className={LABEL_CLASS}>
                Nombres *
              </label>
              <input
                id="pub-firstname"
                data-field="firstName"
                type="text"
                maxLength={120}
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  markTouched('firstName');
                }}
                onBlur={() => markTouched('firstName')}
                aria-invalid={Boolean(getFieldError('firstName'))}
                className={fieldInputClass('firstName', INPUT_CLASS, Boolean(firstName.trim()))}
              />
              <FieldValidationFeedback variant="dark" error={getFieldError('firstName')} />
            </div>
            <div>
              <label htmlFor="pub-lastname" className={LABEL_CLASS}>
                Apellidos *
              </label>
              <input
                id="pub-lastname"
                data-field="lastName"
                type="text"
                maxLength={120}
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  markTouched('lastName');
                }}
                onBlur={() => markTouched('lastName')}
                aria-invalid={Boolean(getFieldError('lastName'))}
                className={fieldInputClass('lastName', INPUT_CLASS, Boolean(lastName.trim()))}
              />
              <FieldValidationFeedback variant="dark" error={getFieldError('lastName')} />
            </div>
            <div>
              <label htmlFor="pub-email" className={LABEL_CLASS}>
                Correo Electrónico (opcional)
              </label>
              <input
                id="pub-email"
                data-field="email"
                type="email"
                maxLength={254}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  markTouched('email');
                }}
                onBlur={() => markTouched('email')}
                aria-invalid={Boolean(getFieldError('email'))}
                placeholder="correo@ejemplo.com"
                className={fieldInputClass('email', INPUT_CLASS, Boolean(email.trim()))}
              />
              <FieldValidationFeedback variant="dark" error={getFieldError('email')} />
            </div>
            <div>
              <label htmlFor="pub-nationality" className={LABEL_CLASS}>
                Nacionalidad (no puntúa en scoring)
              </label>
              <input
                id="pub-nationality"
                type="text"
                maxLength={80}
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="pub-marital" className={LABEL_CLASS}>
                Estado Civil (no puntúa en scoring)
              </label>
              <input
                id="pub-marital"
                type="text"
                maxLength={60}
                value={maritalStatus}
                onChange={(e) => setMaritalStatus(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="pub-muni-prov" className={LABEL_CLASS}>
                Municipio / Provincia
              </label>
              <input
                id="pub-muni-prov"
                type="text"
                maxLength={140}
                value={`${municipality}${province ? `, ${province}` : ''}`}
                onChange={(e) => {
                  const [m, p] = e.target.value.split(',');
                  setMunicipality(m ?? '');
                  setProvince((p ?? '').trim());
                }}
                placeholder="Santo Domingo, DN"
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="sm:col-span-3">
              <label htmlFor="pub-address" className={LABEL_CLASS}>
                Dirección Residencial
              </label>
              <input
                id="pub-address"
                type="text"
                maxLength={300}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Calle, sector, edificio y número"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="pub-resmonths" className={LABEL_CLASS}>
                Tiempo de Residencia (meses)
              </label>
              <input
                id="pub-resmonths"
                data-field="residenceMonths"
                type="number"
                min={0}
                value={residenceMonths}
                onChange={(e) => {
                  setResidenceMonths(Number(e.target.value));
                  markTouched('residenceMonths');
                }}
                onBlur={() => markTouched('residenceMonths')}
                aria-invalid={Boolean(getFieldError('residenceMonths'))}
                className={fieldInputClass('residenceMonths', INPUT_MONO_CLASS, residenceMonths >= 0)}
              />
              <FieldValidationFeedback variant="dark" error={getFieldError('residenceMonths')} />
            </div>
            <div>
              <label htmlFor="pub-housing-type" className={LABEL_CLASS}>
                Tipo de Vivienda
              </label>
              <select
                id="pub-housing-type"
                value={housingType}
                onChange={(e) => setHousingType(e.target.value as HousingType)}
                className={INPUT_CLASS}
              >
                <option value="PROPIA">Propia</option>
                <option value="ALQUILADA">Alquilada</option>
                <option value="FAMILIAR">Familiar</option>
                <option value="OTRA">Otra</option>
                <option value="NO_DECLARADA">No declarada</option>
              </select>
            </div>
            <div>
              <label htmlFor="pub-housing-pay" className={LABEL_CLASS}>
                Pago Mensual de Vivienda
              </label>
              <input
                id="pub-housing-pay"
                data-field="housingPayment"
                type="number"
                min={0}
                value={housingPayment}
                onChange={(e) => {
                  setHousingPayment(Number(e.target.value));
                  markTouched('housingPayment');
                }}
                onBlur={() => markTouched('housingPayment')}
                aria-invalid={Boolean(getFieldError('housingPayment'))}
                className={fieldInputClass('housingPayment', INPUT_MONO_CLASS, housingPayment >= 0)}
              />
              <FieldValidationFeedback variant="dark" error={getFieldError('housingPayment')} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-3 border-t border-white/10">
            <div>
              <label htmlFor="pub-social-decl" className={LABEL_CLASS}>
                Redes Sociales (Equidad)
              </label>
              <select
                id="pub-social-decl"
                value={socialMediaDeclared}
                onChange={(e) => setSocialMediaDeclared(e.target.value as SocialMediaStatus)}
                className={INPUT_CLASS}
              >
                <option value="YES">Sí tiene</option>
                <option value="NO_MEDIA">Declara no tener</option>
                <option value="UNANSWERED">Prefiere no responder</option>
              </select>
            </div>
            <div>
              <label htmlFor="pub-social-handle" className={LABEL_CLASS}>
                Usuario / Handle
              </label>
              <input
                id="pub-social-handle"
                data-field="socialMediaHandle"
                type="text"
                maxLength={120}
                value={socialMediaHandle}
                onChange={(e) => {
                  setSocialMediaHandle(e.target.value);
                  markTouched('socialMediaHandle');
                }}
                onBlur={() => markTouched('socialMediaHandle')}
                aria-invalid={Boolean(getFieldError('socialMediaHandle'))}
                disabled={socialMediaDeclared !== 'YES'}
                placeholder="@usuario"
                className={fieldInputClass(
                  'socialMediaHandle',
                  INPUT_CLASS,
                  Boolean(socialMediaHandle.trim())
                )}
              />
              <FieldValidationFeedback variant="dark" error={getFieldError('socialMediaHandle')} />
            </div>
            <div>
              <label htmlFor="pub-alt-name" className={LABEL_CLASS}>
                Contacto Alternativo (Nombre)
              </label>
              <input
                id="pub-alt-name"
                type="text"
                maxLength={160}
                value={altContactName}
                onChange={(e) => setAltContactName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="pub-alt-phone" className={LABEL_CLASS}>
                Contacto Alternativo (Tel.)
              </label>
              <input
                id="pub-alt-phone"
                data-field="altContactPhone"
                type="tel"
                maxLength={40}
                value={altContactPhone}
                onChange={(e) => {
                  setAltContactPhone(e.target.value);
                  markTouched('altContactPhone');
                }}
                onBlur={() => markTouched('altContactPhone')}
                aria-invalid={Boolean(getFieldError('altContactPhone'))}
                className={fieldInputClass(
                  'altContactPhone',
                  INPUT_MONO_CLASS,
                  Boolean(altContactPhone.trim())
                )}
              />
              <FieldValidationFeedback variant="dark" error={getFieldError('altContactPhone')} />
            </div>
          </div>

          {applicantType === 'BUSINESS' && (
            <div className="pt-4 border-t border-white/10 space-y-3.5">
              <h3 className="text-sm font-semibold text-white">Datos Societarios de la Empresa</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label htmlFor="pub-rnc" className={LABEL_CLASS}>
                    RNC *
                  </label>
                  <input
                    id="pub-rnc"
                    data-field="rnc"
                    type="text"
                    maxLength={40}
                    value={rnc}
                    onChange={(e) => {
                      setRnc(e.target.value);
                      markTouched('rnc');
                    }}
                    onBlur={() => markTouched('rnc')}
                    aria-invalid={Boolean(getFieldError('rnc'))}
                    placeholder="1-31-99887-2"
                    className={fieldInputClass('rnc', INPUT_MONO_CLASS, Boolean(rnc.trim()))}
                  />
                  <FieldValidationFeedback
                    variant="dark"
                    error={getFieldError('rnc')}
                    validHint={
                      touchedFields.rnc && !validation.errors.rnc && rnc.trim()
                        ? 'RNC válido'
                        : undefined
                    }
                  />
                </div>
                <div>
                  <label htmlFor="pub-legal-name" className={LABEL_CLASS}>
                    Razón Social *
                  </label>
                  <input
                    id="pub-legal-name"
                    data-field="legalName"
                    type="text"
                    maxLength={200}
                    value={legalName}
                    onChange={(e) => {
                      setLegalName(e.target.value);
                      markTouched('legalName');
                    }}
                    onBlur={() => markTouched('legalName')}
                    aria-invalid={Boolean(getFieldError('legalName'))}
                    className={fieldInputClass('legalName', INPUT_CLASS, Boolean(legalName.trim()))}
                  />
                  <FieldValidationFeedback variant="dark" error={getFieldError('legalName')} />
                </div>
                <div>
                  <label htmlFor="pub-trade-name" className={LABEL_CLASS}>
                    Nombre Comercial
                  </label>
                  <input
                    id="pub-trade-name"
                    type="text"
                    maxLength={200}
                    value={tradeName}
                    onChange={(e) => setTradeName(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="pub-company-type" className={LABEL_CLASS}>
                    Tipo de Empresa
                  </label>
                  <input
                    id="pub-company-type"
                    type="text"
                    maxLength={80}
                    value={companyType}
                    onChange={(e) => setCompanyType(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="pub-econ-act" className={LABEL_CLASS}>
                    Actividad Económica
                  </label>
                  <input
                    id="pub-econ-act"
                    type="text"
                    maxLength={160}
                    value={economicActivity}
                    onChange={(e) => setEconomicActivity(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="pub-ops-start" className={LABEL_CLASS}>
                    Inicio de Operaciones
                  </label>
                  <input
                    id="pub-ops-start"
                    data-field="operationsStartDate"
                    type="date"
                    value={operationsStartDate}
                    onChange={(e) => {
                      setOperationsStartDate(e.target.value);
                      markTouched('operationsStartDate');
                    }}
                    onBlur={() => markTouched('operationsStartDate')}
                    aria-invalid={Boolean(getFieldError('operationsStartDate'))}
                    className={fieldInputClass(
                      'operationsStartDate',
                      INPUT_CLASS,
                      Boolean(operationsStartDate.trim())
                    )}
                  />
                  <FieldValidationFeedback
                    variant="dark"
                    error={getFieldError('operationsStartDate')}
                  />
                </div>
                <div>
                  <label htmlFor="pub-rep-name" className={LABEL_CLASS}>
                    Representante Autorizado *
                  </label>
                  <input
                    id="pub-rep-name"
                    data-field="authorizedRepName"
                    type="text"
                    maxLength={160}
                    value={authorizedRepName}
                    onChange={(e) => {
                      setAuthorizedRepName(e.target.value);
                      markTouched('authorizedRepName');
                    }}
                    onBlur={() => markTouched('authorizedRepName')}
                    aria-invalid={Boolean(getFieldError('authorizedRepName'))}
                    className={fieldInputClass(
                      'authorizedRepName',
                      INPUT_CLASS,
                      Boolean(authorizedRepName.trim())
                    )}
                  />
                  <FieldValidationFeedback
                    variant="dark"
                    error={getFieldError('authorizedRepName')}
                  />
                </div>
                <div>
                  <label htmlFor="pub-rep-doc" className={LABEL_CLASS}>
                    Doc. Representante
                  </label>
                  <input
                    id="pub-rep-doc"
                    data-field="authorizedRepDoc"
                    type="text"
                    maxLength={40}
                    value={authorizedRepDoc}
                    onChange={(e) => {
                      setAuthorizedRepDoc(e.target.value);
                      markTouched('authorizedRepDoc');
                    }}
                    onBlur={() => markTouched('authorizedRepDoc')}
                    aria-invalid={Boolean(getFieldError('authorizedRepDoc'))}
                    className={fieldInputClass(
                      'authorizedRepDoc',
                      INPUT_MONO_CLASS,
                      Boolean(authorizedRepDoc.trim())
                    )}
                  />
                  <FieldValidationFeedback
                    variant="dark"
                    error={getFieldError('authorizedRepDoc')}
                  />
                </div>
                <div>
                  <label htmlFor="pub-corp-docs" className={LABEL_CLASS}>
                    Documentación Societaria
                  </label>
                  <input
                    id="pub-corp-docs"
                    type="text"
                    maxLength={500}
                    value={corporateDocsSummary}
                    onChange={(e) => setCorporateDocsSummary(e.target.value)}
                    placeholder="Registro mercantil, acta, RNC"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== STEP 2: LABORAL Y FINANZAS ==================== */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label htmlFor="pub-activity" className={LABEL_CLASS}>
                Tipo de Actividad
              </label>
              <input
                id="pub-activity"
                type="text"
                maxLength={120}
                value={activityType}
                onChange={(e) => setActivityType(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="pub-employer" className={LABEL_CLASS}>
                Empresa o Negocio
              </label>
              <input
                id="pub-employer"
                type="text"
                maxLength={160}
                value={employerOrBusinessName}
                onChange={(e) => setEmployerOrBusinessName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="pub-role" className={LABEL_CLASS}>
                Cargo u Ocupación
              </label>
              <input
                id="pub-role"
                type="text"
                maxLength={120}
                value={occupationOrRole}
                onChange={(e) => setOccupationOrRole(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="pub-empmonths" className={LABEL_CLASS}>
                Antigüedad Laboral/Comercial (meses)
              </label>
              <input
                id="pub-empmonths"
                data-field="employmentMonths"
                type="number"
                min={0}
                value={employmentMonths}
                onChange={(e) => {
                  setEmploymentMonths(Number(e.target.value));
                  markTouched('employmentMonths');
                }}
                onBlur={() => markTouched('employmentMonths')}
                aria-invalid={Boolean(getFieldError('employmentMonths'))}
                className={fieldInputClass('employmentMonths', INPUT_MONO_CLASS, employmentMonths >= 0)}
              />
              <FieldValidationFeedback variant="dark" error={getFieldError('employmentMonths')} />
            </div>
            <div>
              <label htmlFor="pub-incsource" className={LABEL_CLASS}>
                Fuente de Ingresos
              </label>
              <select
                id="pub-incsource"
                value={incomeSourceType}
                onChange={(e) => setIncomeSourceType(e.target.value as IncomeSourceType)}
                className={INPUT_CLASS}
              >
                <option value="FIJA_RECURRENTE">Fija o recurrente</option>
                <option value="MIXTA_RECURRENTE">Mixta recurrente</option>
                <option value="IRREGULAR">Irregular</option>
                <option value="SIN_INGRESOS">Sin ingresos</option>
              </select>
            </div>
            <div>
              <label htmlFor="pub-inccurrency" className={LABEL_CLASS}>
                Moneda de los Ingresos
              </label>
              <select
                id="pub-inccurrency"
                value={incomeCurrency}
                onChange={(e) => setIncomeCurrency(e.target.value as CurrencyCode)}
                className={INPUT_CLASS}
              >
                <option value="DOP">DOP (Pesos Dominicanos)</option>
                <option value="USD">USD (Dólares Estadounidenses)</option>
              </select>
            </div>
          </div>

          {applicantType === 'BUSINESS' ? (
            <div className="p-4 rounded-xl border border-white/10 bg-white/[0.03] space-y-3.5">
              <h4 className="text-xs font-semibold text-white">
                Flujo Empresarial (No confundir ventas brutas con flujo neto disponible)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div>
                  <label htmlFor="pub-gross-sales" className={LABEL_CLASS}>
                    Ventas Brutas Mensuales
                  </label>
                  <input
                    id="pub-gross-sales"
                    data-field="grossSales"
                    type="number"
                    min={0}
                    value={grossSales}
                    onChange={(e) => {
                      setGrossSales(e.target.value);
                      markTouched('grossSales');
                    }}
                    onBlur={() => markTouched('grossSales')}
                    aria-invalid={Boolean(getFieldError('grossSales'))}
                    className={fieldInputClass(
                      'grossSales',
                      INPUT_MONO_CLASS,
                      Boolean(grossSales.trim())
                    )}
                  />
                  <FieldValidationFeedback variant="dark" error={getFieldError('grossSales')} />
                </div>
                <div>
                  <label htmlFor="pub-op-costs" className={LABEL_CLASS}>
                    Costos Operativos
                  </label>
                  <input
                    id="pub-op-costs"
                    data-field="operatingCosts"
                    type="number"
                    min={0}
                    value={operatingCosts}
                    onChange={(e) => {
                      setOperatingCosts(e.target.value);
                      markTouched('operatingCosts');
                    }}
                    onBlur={() => markTouched('operatingCosts')}
                    aria-invalid={Boolean(getFieldError('operatingCosts'))}
                    className={fieldInputClass(
                      'operatingCosts',
                      INPUT_MONO_CLASS,
                      Boolean(operatingCosts.trim())
                    )}
                  />
                  <FieldValidationFeedback variant="dark" error={getFieldError('operatingCosts')} />
                </div>
                <div>
                  <label htmlFor="pub-net-flow" className={LABEL_CLASS}>
                    Flujo Neto Mensual Disponible *
                  </label>
                  <input
                    id="pub-net-flow"
                    data-field="netMonthlyFlow"
                    type="number"
                    min={0}
                    value={netMonthlyFlow}
                    onChange={(e) => {
                      setNetMonthlyFlow(e.target.value);
                      markTouched('netMonthlyFlow');
                    }}
                    onBlur={() => markTouched('netMonthlyFlow')}
                    aria-invalid={Boolean(getFieldError('netMonthlyFlow'))}
                    className={fieldInputClass(
                      'netMonthlyFlow',
                      INPUT_MONO_CLASS,
                      Boolean(netMonthlyFlow.trim())
                    )}
                  />
                  <FieldValidationFeedback
                    variant="dark"
                    error={getFieldError('netMonthlyFlow')}
                    warning={getFieldWarning('netMonthlyFlow')}
                  />
                </div>
                <div>
                  <label htmlFor="pub-repay-src" className={LABEL_CLASS}>
                    Origen Principal del Repago
                  </label>
                  <input
                    id="pub-repay-src"
                    type="text"
                    maxLength={200}
                    value={repaymentSource}
                    onChange={(e) => setRepaymentSource(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label htmlFor="pub-primary-inc" className={LABEL_CLASS}>
                  Ingreso Principal Neto Mensual {incomeSourceType !== 'SIN_INGRESOS' ? '*' : ''}
                </label>
                <input
                  id="pub-primary-inc"
                  data-field="primaryNetIncome"
                  type="number"
                  min={0}
                  value={primaryNetIncome}
                  onChange={(e) => {
                    setPrimaryNetIncome(e.target.value);
                    markTouched('primaryNetIncome');
                  }}
                  onBlur={() => markTouched('primaryNetIncome')}
                  aria-invalid={Boolean(getFieldError('primaryNetIncome'))}
                  className={fieldInputClass(
                    'primaryNetIncome',
                    INPUT_MONO_CLASS,
                    Boolean(primaryNetIncome.trim())
                  )}
                />
                <FieldValidationFeedback variant="dark" error={getFieldError('primaryNetIncome')} />
              </div>
              <div>
                <label htmlFor="pub-add-inc-status" className={LABEL_CLASS}>
                  Estado Ingresos Adicionales
                </label>
                <select
                  id="pub-add-inc-status"
                  value={additionalIncomeStatus}
                  onChange={(e) => {
                    const s = e.target.value as AdditionalIncomeStatus;
                    setAdditionalIncomeStatus(s);
                    if (s === 'EXPLICIT_NONE') setAdditionalNetIncome('0');
                  }}
                  className={INPUT_CLASS}
                >
                  <option value="EXPLICIT_NONE">Declara expresamente no tener</option>
                  <option value="QUANTIFIED">Cuantificados (ponderan 70%)</option>
                  <option value="PARTIAL">Declaración parcial</option>
                  <option value="INCONSISTENT">Inconsistente</option>
                </select>
              </div>
              <div>
                <label htmlFor="pub-add-inc" className={LABEL_CLASS}>
                  Ingresos Adicionales Netos
                </label>
                <input
                  id="pub-add-inc"
                  data-field="additionalNetIncome"
                  type="number"
                  min={0}
                  value={additionalNetIncome}
                  onChange={(e) => {
                    setAdditionalNetIncome(e.target.value);
                    markTouched('additionalNetIncome');
                  }}
                  onBlur={() => markTouched('additionalNetIncome')}
                  aria-invalid={Boolean(getFieldError('additionalNetIncome'))}
                  disabled={additionalIncomeStatus === 'EXPLICIT_NONE'}
                  className={fieldInputClass(
                    'additionalNetIncome',
                    INPUT_MONO_CLASS,
                    additionalIncomeStatus !== 'EXPLICIT_NONE' && Boolean(additionalNetIncome.trim())
                  )}
                />
                <FieldValidationFeedback
                  variant="dark"
                  error={getFieldError('additionalNetIncome')}
                />
              </div>
              <div>
                <label htmlFor="pub-decl-total" className={LABEL_CLASS}>
                  Ingreso Total Declarado (control)
                </label>
                <input
                  id="pub-decl-total"
                  data-field="declaredTotalMonthlyIncome"
                  type="number"
                  min={0}
                  value={declaredTotalMonthlyIncome}
                  onChange={(e) => {
                    setDeclaredTotalMonthlyIncome(e.target.value);
                    markTouched('declaredTotalMonthlyIncome');
                  }}
                  onBlur={() => markTouched('declaredTotalMonthlyIncome')}
                  aria-invalid={Boolean(getFieldError('declaredTotalMonthlyIncome'))}
                  placeholder="Opcional para conciliación"
                  className={fieldInputClass(
                    'declaredTotalMonthlyIncome',
                    INPUT_MONO_CLASS,
                    Boolean(declaredTotalMonthlyIncome.trim())
                  )}
                />
                <FieldValidationFeedback
                  variant="dark"
                  error={getFieldError('declaredTotalMonthlyIncome')}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-3 border-t border-white/10">
            <div>
              <label htmlFor="pub-essential-exp" className={LABEL_CLASS}>
                Gastos Esenciales Mensuales (sin cuotas de deuda) *
              </label>
              <input
                id="pub-essential-exp"
                data-field="essentialExpenses"
                type="number"
                min={0}
                value={essentialExpenses}
                onChange={(e) => {
                  setEssentialExpenses(e.target.value);
                  markTouched('essentialExpenses');
                }}
                onBlur={() => markTouched('essentialExpenses')}
                aria-invalid={Boolean(getFieldError('essentialExpenses'))}
                className={fieldInputClass(
                  'essentialExpenses',
                  INPUT_MONO_CLASS,
                  Boolean(essentialExpenses.trim())
                )}
              />
              <FieldValidationFeedback variant="dark" error={getFieldError('essentialExpenses')} />
            </div>
            <div className="flex items-end pb-1.5">
              <label className="inline-flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={housingIncludedInExpenses}
                  onChange={(e) => setHousingIncludedInExpenses(e.target.checked)}
                  className="mt-0.5 rounded border-white/25 bg-[#030816]"
                />
                <span>
                  El pago de vivienda ya está incluido dentro de los gastos esenciales (evitar doble descuento)
                </span>
              </label>
            </div>
          </div>

          <div className="pt-3 border-t border-white/10 space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label htmlFor="pub-debt-decl" className={LABEL_CLASS}>
                  Declaración de Deudas
                </label>
                <select
                  id="pub-debt-decl"
                  value={debtDeclarationStatus}
                  onChange={(e) => {
                    const s = e.target.value as DebtDeclarationStatus;
                    setDebtDeclarationStatus(s);
                    if (s === 'NO_DEBTS_EXPLICIT') {
                      setDebtCount('0');
                      setTotalDebtBalance('0');
                      setCurrentDebtPayments('0');
                      setBankDebtPayment('0');
                      setFinanceDebtPayment('0');
                      setCardDebtPayment('0');
                      setInformalDebtPayment('0');
                      setOtherDebtPayment('0');
                    }
                  }}
                  className={INPUT_CLASS}
                >
                  <option value="NO_DEBTS_EXPLICIT">Declara expresamente CERO deudas</option>
                  <option value="HAS_DEBTS">Posee deudas activas</option>
                  <option value="UNDECLARED">Información no suministrada</option>
                </select>
              </div>
              <div>
                <label htmlFor="pub-debt-count" className={LABEL_CLASS}>
                  Cantidad de Deudas {debtDeclarationStatus === 'HAS_DEBTS' ? '*' : ''}
                </label>
                <input
                  id="pub-debt-count"
                  data-field="debtCount"
                  type="number"
                  min={0}
                  value={debtCount}
                  onChange={(e) => {
                    setDebtCount(e.target.value);
                    markTouched('debtCount');
                  }}
                  onBlur={() => markTouched('debtCount')}
                  aria-invalid={Boolean(getFieldError('debtCount'))}
                  disabled={debtDeclarationStatus !== 'HAS_DEBTS'}
                  className={fieldInputClass(
                    'debtCount',
                    INPUT_MONO_CLASS,
                    debtDeclarationStatus === 'HAS_DEBTS' && Boolean(debtCount.trim())
                  )}
                />
                <FieldValidationFeedback variant="dark" error={getFieldError('debtCount')} />
              </div>
              <div>
                <label htmlFor="pub-debt-bal" className={LABEL_CLASS}>
                  Saldo Total Adeudado {debtDeclarationStatus === 'HAS_DEBTS' ? '*' : ''}
                </label>
                <input
                  id="pub-debt-bal"
                  data-field="totalDebtBalance"
                  type="number"
                  min={0}
                  value={totalDebtBalance}
                  onChange={(e) => {
                    setTotalDebtBalance(e.target.value);
                    markTouched('totalDebtBalance');
                  }}
                  onBlur={() => markTouched('totalDebtBalance')}
                  aria-invalid={Boolean(getFieldError('totalDebtBalance'))}
                  disabled={debtDeclarationStatus !== 'HAS_DEBTS'}
                  className={fieldInputClass(
                    'totalDebtBalance',
                    INPUT_MONO_CLASS,
                    debtDeclarationStatus === 'HAS_DEBTS' && Boolean(totalDebtBalance.trim())
                  )}
                />
                <FieldValidationFeedback variant="dark" error={getFieldError('totalDebtBalance')} />
              </div>
              <div>
                <label htmlFor="pub-debt-pmt" className={LABEL_CLASS}>
                  Cuotas Mensuales Totales (D) {debtDeclarationStatus === 'HAS_DEBTS' ? '*' : ''}
                </label>
                <input
                  id="pub-debt-pmt"
                  data-field="currentDebtPayments"
                  type="number"
                  min={0}
                  value={currentDebtPayments}
                  onChange={(e) => {
                    setCurrentDebtPayments(e.target.value);
                    markTouched('currentDebtPayments');
                  }}
                  onBlur={() => markTouched('currentDebtPayments')}
                  aria-invalid={Boolean(getFieldError('currentDebtPayments'))}
                  disabled={debtDeclarationStatus !== 'HAS_DEBTS'}
                  className={fieldInputClass(
                    'currentDebtPayments',
                    INPUT_MONO_CLASS,
                    debtDeclarationStatus === 'HAS_DEBTS' && Boolean(currentDebtPayments.trim())
                  )}
                />
                <FieldValidationFeedback
                  variant="dark"
                  error={getFieldError('currentDebtPayments')}
                />
              </div>
            </div>

            {debtDeclarationStatus === 'HAS_DEBTS' && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                <div>
                  <label htmlFor="pub-debt-bank" className="block mb-1 text-slate-400">
                    Cuota Bancos
                  </label>
                  <input
                    id="pub-debt-bank"
                    data-field="bankDebtPayment"
                    type="number"
                    min={0}
                    value={bankDebtPayment}
                    onChange={(e) => {
                      setBankDebtPayment(e.target.value);
                      markTouched('bankDebtPayment');
                    }}
                    onBlur={() => markTouched('bankDebtPayment')}
                    aria-invalid={Boolean(getFieldError('bankDebtPayment'))}
                    className={fieldInputClass(
                      'bankDebtPayment',
                      INPUT_MONO_CLASS,
                      Boolean(bankDebtPayment.trim())
                    )}
                  />
                  <FieldValidationFeedback variant="dark" error={getFieldError('bankDebtPayment')} />
                </div>
                <div>
                  <label htmlFor="pub-debt-fin" className="block mb-1 text-slate-400">
                    Cuota Financieras
                  </label>
                  <input
                    id="pub-debt-fin"
                    data-field="financeDebtPayment"
                    type="number"
                    min={0}
                    value={financeDebtPayment}
                    onChange={(e) => {
                      setFinanceDebtPayment(e.target.value);
                      markTouched('financeDebtPayment');
                    }}
                    onBlur={() => markTouched('financeDebtPayment')}
                    aria-invalid={Boolean(getFieldError('financeDebtPayment'))}
                    className={fieldInputClass(
                      'financeDebtPayment',
                      INPUT_MONO_CLASS,
                      Boolean(financeDebtPayment.trim())
                    )}
                  />
                  <FieldValidationFeedback
                    variant="dark"
                    error={getFieldError('financeDebtPayment')}
                  />
                </div>
                <div>
                  <label htmlFor="pub-debt-card" className="block mb-1 text-slate-400">
                    Cuota Tarjetas
                  </label>
                  <input
                    id="pub-debt-card"
                    data-field="cardDebtPayment"
                    type="number"
                    min={0}
                    value={cardDebtPayment}
                    onChange={(e) => {
                      setCardDebtPayment(e.target.value);
                      markTouched('cardDebtPayment');
                    }}
                    onBlur={() => markTouched('cardDebtPayment')}
                    aria-invalid={Boolean(getFieldError('cardDebtPayment'))}
                    className={fieldInputClass(
                      'cardDebtPayment',
                      INPUT_MONO_CLASS,
                      Boolean(cardDebtPayment.trim())
                    )}
                  />
                  <FieldValidationFeedback variant="dark" error={getFieldError('cardDebtPayment')} />
                </div>
                <div>
                  <label htmlFor="pub-debt-inf" className="block mb-1 text-slate-400">
                    Préstamos Informales
                  </label>
                  <input
                    id="pub-debt-inf"
                    data-field="informalDebtPayment"
                    type="number"
                    min={0}
                    value={informalDebtPayment}
                    onChange={(e) => {
                      setInformalDebtPayment(e.target.value);
                      markTouched('informalDebtPayment');
                    }}
                    onBlur={() => markTouched('informalDebtPayment')}
                    aria-invalid={Boolean(getFieldError('informalDebtPayment'))}
                    className={fieldInputClass(
                      'informalDebtPayment',
                      INPUT_MONO_CLASS,
                      Boolean(informalDebtPayment.trim())
                    )}
                  />
                  <FieldValidationFeedback
                    variant="dark"
                    error={getFieldError('informalDebtPayment')}
                  />
                </div>
                <div>
                  <label htmlFor="pub-debt-other" className="block mb-1 text-slate-400">
                    Otras Obligaciones
                  </label>
                  <input
                    id="pub-debt-other"
                    data-field="otherDebtPayment"
                    type="number"
                    min={0}
                    value={otherDebtPayment}
                    onChange={(e) => {
                      setOtherDebtPayment(e.target.value);
                      markTouched('otherDebtPayment');
                    }}
                    onBlur={() => markTouched('otherDebtPayment')}
                    aria-invalid={Boolean(getFieldError('otherDebtPayment'))}
                    className={fieldInputClass(
                      'otherDebtPayment',
                      INPUT_MONO_CLASS,
                      Boolean(otherDebtPayment.trim())
                    )}
                  />
                  <FieldValidationFeedback
                    variant="dark"
                    error={getFieldError('otherDebtPayment')}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== STEP 3: CONDICIONES ==================== */}
      {step === 3 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label htmlFor="pub-product" className={LABEL_CLASS}>
                Producto / Tipo de Préstamo
              </label>
              <select
                id="pub-product"
                value={productCode}
                onChange={(e) => {
                  const nextProd = e.target.value as ProductCode;
                  setProductCode(nextProd);
                  setApplicantType(nextProd.startsWith('EMPRESARIAL') ? 'BUSINESS' : 'INDIVIDUAL');
                }}
                className={INPUT_CLASS}
              >
                {Object.entries(PRODUCT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pub-amount" className={LABEL_CLASS}>
                Monto Solicitado ({derivedCurrency}) *
              </label>
              <input
                id="pub-amount"
                data-field="requestedAmount"
                type="number"
                min={1}
                max={100000000}
                value={requestedAmount}
                onChange={(e) => {
                  setRequestedAmount(e.target.value);
                  markTouched('requestedAmount');
                }}
                onBlur={() => markTouched('requestedAmount')}
                aria-invalid={Boolean(getFieldError('requestedAmount'))}
                className={fieldInputClass(
                  'requestedAmount',
                  INPUT_MONO_CLASS,
                  Boolean(requestedAmount.trim())
                )}
              />
              <FieldValidationFeedback
                variant="dark"
                error={getFieldError('requestedAmount')}
                warning={getFieldWarning('requestedAmount')}
              />
            </div>
            <div>
              <label htmlFor="pub-term" className={LABEL_CLASS}>
                Plazo Solicitado (Meses) *
              </label>
              <input
                id="pub-term"
                data-field="requestedTermMonths"
                type="number"
                min={1}
                max={360}
                value={requestedTermMonths}
                onChange={(e) => {
                  setRequestedTermMonths(e.target.value);
                  markTouched('requestedTermMonths');
                }}
                onBlur={() => markTouched('requestedTermMonths')}
                aria-invalid={Boolean(getFieldError('requestedTermMonths'))}
                className={fieldInputClass(
                  'requestedTermMonths',
                  INPUT_MONO_CLASS,
                  Boolean(requestedTermMonths.trim())
                )}
              />
              <FieldValidationFeedback
                variant="dark"
                error={getFieldError('requestedTermMonths')}
                warning={getFieldWarning('requestedTermMonths')}
              />
            </div>
            <div>
              <label htmlFor="pub-freq" className={LABEL_CLASS}>
                Frecuencia de Pago
              </label>
              <select
                id="pub-freq"
                value={paymentFrequency}
                onChange={(e) => setPaymentFrequency(e.target.value as PaymentFrequency)}
                className={INPUT_CLASS}
              >
                <option value="MENSUAL">Mensual</option>
                <option value="QUINCENAL">Quincenal</option>
                <option value="SEMANAL">Semanal</option>
                <option value="DIARIA">Diaria</option>
              </select>
            </div>
            <div>
              <label htmlFor="pub-purpose" className={LABEL_CLASS}>
                Destino del Financiamiento *
              </label>
              <input
                id="pub-purpose"
                data-field="loanPurpose"
                type="text"
                maxLength={120}
                value={loanPurpose}
                onChange={(e) => {
                  setLoanPurpose(e.target.value);
                  markTouched('loanPurpose');
                }}
                onBlur={() => markTouched('loanPurpose')}
                aria-invalid={Boolean(getFieldError('loanPurpose'))}
                className={fieldInputClass('loanPurpose', INPUT_CLASS, Boolean(loanPurpose.trim()))}
              />
              <FieldValidationFeedback variant="dark" error={getFieldError('loanPurpose')} />
            </div>
            <div>
              <label htmlFor="pub-collateral" className={LABEL_CLASS}>
                Garantía Propuesta (si aplica)
              </label>
              <input
                id="pub-collateral"
                type="text"
                maxLength={500}
                value={proposedCollateral}
                onChange={(e) => setProposedCollateral(e.target.value)}
                placeholder="Vehículo, hipoteca, fianza solidaria..."
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label htmlFor="pub-amort" className={LABEL_CLASS}>
                Modalidad de Amortización
              </label>
              <select
                id="pub-amort"
                value={amortizationMethod}
                onChange={(e) => setAmortizationMethod(e.target.value as AmortizationMethod)}
                className={INPUT_CLASS}
              >
                <option value="SALDO_INSOLUTO">Sobre saldo insoluto</option>
                <option value="INTERES_FIJO">Interés fijo</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="pub-purpose-desc" className={LABEL_CLASS}>
                Descripción Detallada del Destino
              </label>
              <textarea
                id="pub-purpose-desc"
                rows={2}
                maxLength={1000}
                value={loanPurposeDescription}
                onChange={(e) => setLoanPurposeDescription(e.target.value)}
                placeholder="Detalle en qué se invertirán o utilizarán los fondos..."
                className={`${INPUT_CLASS} resize-none`}
              />
            </div>
          </div>

          {/* Indicative Installment Preview Strip */}
          <div className="p-3.5 rounded-xl border border-white/12 bg-[#030816]/75 grid grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Calculator className="w-3 h-3 text-[#00D1FF]" />
                Cuota estimada
              </span>
              <p className="font-mono font-bold text-sm sm:text-base text-white tabular-nums mt-0.5">
                {formatMoney(indicative.installmentAmount, derivedCurrency)}
              </p>
            </div>
            <div>
              <span className="text-[11px] text-slate-400 block">
                Cuotas ({paymentFrequency.toLowerCase()})
              </span>
              <p className="font-mono font-semibold text-sm text-slate-200 tabular-nums mt-0.5">
                {indicative.installmentsCount} cuotas
              </p>
            </div>
            <div>
              <span className="text-[11px] text-slate-400 block">Evaluación</span>
              <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                Sujeto a evaluación crediticia de {instName}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ==================== STEP 4: REFERENCIAS Y DOCS ==================== */}
      {step === 4 && (
        <div className="space-y-5">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white">
              Referencias Personales / Comerciales (no requieren llamada previa al scoring)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <input
                  data-field="ref1Name"
                  type="text"
                  maxLength={120}
                  placeholder="Referencia 1: Nombre completo"
                  value={ref1Name}
                  onChange={(e) => {
                    setRef1Name(e.target.value);
                    markTouched('ref1Name');
                  }}
                  onBlur={() => markTouched('ref1Name')}
                  aria-invalid={Boolean(getFieldError('ref1Name'))}
                  className={fieldInputClass('ref1Name', INPUT_CLASS, Boolean(ref1Name.trim()))}
                />
                <FieldValidationFeedback variant="dark" error={getFieldError('ref1Name')} />
              </div>
              <div>
                <input
                  type="text"
                  maxLength={80}
                  placeholder="Relación (Ej. Hermano, Proveedor)"
                  value={ref1Rel}
                  onChange={(e) => setRef1Rel(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <input
                  data-field="ref1Phone"
                  type="tel"
                  maxLength={40}
                  placeholder="Teléfono (ej. 809-555-0000)"
                  value={ref1Phone}
                  onChange={(e) => {
                    setRef1Phone(e.target.value);
                    markTouched('ref1Phone');
                  }}
                  onBlur={() => markTouched('ref1Phone')}
                  aria-invalid={Boolean(getFieldError('ref1Phone'))}
                  className={fieldInputClass(
                    'ref1Phone',
                    INPUT_MONO_CLASS,
                    Boolean(ref1Phone.trim())
                  )}
                />
                <FieldValidationFeedback variant="dark" error={getFieldError('ref1Phone')} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <input
                  data-field="ref2Name"
                  type="text"
                  maxLength={120}
                  placeholder="Referencia 2: Nombre completo"
                  value={ref2Name}
                  onChange={(e) => {
                    setRef2Name(e.target.value);
                    markTouched('ref2Name');
                  }}
                  onBlur={() => markTouched('ref2Name')}
                  aria-invalid={Boolean(getFieldError('ref2Name'))}
                  className={fieldInputClass('ref2Name', INPUT_CLASS, Boolean(ref2Name.trim()))}
                />
                <FieldValidationFeedback variant="dark" error={getFieldError('ref2Name')} />
              </div>
              <div>
                <input
                  type="text"
                  maxLength={80}
                  placeholder="Relación"
                  value={ref2Rel}
                  onChange={(e) => setRef2Rel(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <input
                  data-field="ref2Phone"
                  type="tel"
                  maxLength={40}
                  placeholder="Teléfono (ej. 809-555-0000)"
                  value={ref2Phone}
                  onChange={(e) => {
                    setRef2Phone(e.target.value);
                    markTouched('ref2Phone');
                  }}
                  onBlur={() => markTouched('ref2Phone')}
                  aria-invalid={Boolean(getFieldError('ref2Phone'))}
                  className={fieldInputClass(
                    'ref2Phone',
                    INPUT_MONO_CLASS,
                    Boolean(ref2Phone.trim())
                  )}
                />
                <FieldValidationFeedback variant="dark" error={getFieldError('ref2Phone')} />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/10 space-y-3">
            <h3 className="text-sm font-semibold text-white">
              Documentos Suministrados en Expediente
            </h3>
            <div className="flex flex-wrap gap-5 text-xs text-slate-300">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasIdentityDoc}
                  onChange={(e) => setHasIdentityDoc(e.target.checked)}
                />
                <span>Documento de identidad suministrado</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasIncomeEvidence}
                  onChange={(e) => setHasIncomeEvidence(e.target.checked)}
                />
                <span>Evidencia de ingresos suministrada</span>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="p-3.5 rounded-xl border border-dashed border-[#00B8FF]/35 bg-[#030816]/60 flex items-center gap-3 text-xs text-slate-200 cursor-pointer hover:border-[#00B8FF] transition-colors">
                <Upload className="w-4 h-4 text-[#00D1FF] shrink-0" />
                <span>Adjuntar Cédula / Identidad (foto o PDF)</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    void handleFileAttach('Identidad', e.target.files?.[0] ?? null);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              <label className="p-3.5 rounded-xl border border-dashed border-[#00B8FF]/35 bg-[#030816]/60 flex items-center gap-3 text-xs text-slate-200 cursor-pointer hover:border-[#00B8FF] transition-colors">
                <Upload className="w-4 h-4 text-[#00D1FF] shrink-0" />
                <span>Adjuntar Evidencia de Ingresos (foto o PDF)</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    void handleFileAttach('Ingresos', e.target.files?.[0] ?? null);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>

            {pendingFiles.length > 0 && (
              <ul className="text-xs text-slate-300 space-y-1.5 pt-1">
                {pendingFiles.map((f, idx) => (
                  <li
                    key={`${f.category}-${f.fileName}-${idx}`}
                    className="font-mono flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/10"
                  >
                    <span className="truncate">
                      [{f.category}] {f.fileName} ({Math.round(f.sizeBytes / 1024)} KB)
                    </span>
                    <button
                      type="button"
                      onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-[11px] font-sans text-rose-400 hover:underline shrink-0 cursor-pointer"
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <BiometricIdentityVerifier
              applicantFullName={`${firstName} ${lastName}`.trim()}
              documentType={documentType}
              documentNumber={documentNumber}
              identityFiles={pendingFiles.filter((f) => f.category === 'Identidad')}
              onAttachIdentityFile={(file) => {
                void handleFileAttach('Identidad', file);
              }}
              onSaveBiometricCapture={handleSaveBiometricCapture}
              onBiometricResultChange={setBiometricResult}
              maxCaptureBytes={230 * 1024}
            />
          </div>
        </div>
      )}

      {/* ==================== STEP 5: CONSENTIMIENTO ==================== */}
      {step === 5 && (
        <div className="space-y-4">
          {biometricResult && (
            <div className="p-3.5 rounded-xl border border-[#00B8FF]/30 bg-[#0066FF]/10 text-xs flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-white">
                  Verificación Biométrica (Cámara + Visión IA):{' '}
                </span>
                <span className="text-slate-200">
                  {BIOMETRIC_VERDICT_LABELS[biometricResult.verdict]}
                </span>
              </div>
              <span className="font-mono tabular-nums font-bold text-[#00D1FF]">
                Similitud {biometricResult.similarityScore}% · Liveness{' '}
                {biometricResult.livenessAssessment}
              </span>
            </div>
          )}

          {/* Review Summary Strip */}
          <div className="p-3.5 rounded-xl border border-white/10 bg-[#030816]/75 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-[11px] text-slate-400 block">Solicitante</span>
              <span className="font-semibold text-white block truncate">
                {firstName || lastName ? `${firstName} ${lastName}`.trim() : 'Pendiente'}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-slate-400 block">Producto</span>
              <span className="font-medium text-slate-200 block truncate">
                {PRODUCT_LABELS[productCode]}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-slate-400 block">Monto Solicitado</span>
              <span className="font-mono font-bold text-white tabular-nums">
                {formatMoney(Number(requestedAmount) || 0, derivedCurrency)}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-slate-400 block">Plazo y Frecuencia</span>
              <span className="font-mono font-semibold text-slate-200 tabular-nums">
                {requestedTermMonths} meses · {paymentFrequency}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-white/12 bg-white/[0.03] space-y-2 text-xs text-slate-300 leading-relaxed">
            <p className="font-semibold text-white">
              Términos y Autorización de Tratamiento de Datos — Ley 172-13 ({CONSENT_VERSION})
            </p>
            <p>
              Declaro bajo fe de juramento que la información personal, laboral, financiera y de
              obligaciones suministrada en esta solicitud es verídica y comprobable. Autorizo
              expresamente a <strong className="text-white">{instName}</strong> al tratamiento de
              mis datos personales y crediticios para fines de evaluación de riesgo, cumplimiento
              regulatorio, formalización contractual y administración de cartera, conforme a la Ley
              No. 172-13 de la República Dominicana.
            </p>
            <p>
              Comprendo que el resultado emitido tras el envío constituye una precalificación
              preliminar y no equivale a una aprobación definitiva ni a un desembolso automático.
            </p>
          </div>

          {([1, 2, 3, 4] as const).some((s) => validation.stepErrorCounts[s] > 0) && (
            <div className="p-3.5 rounded-xl border border-amber-400/35 bg-amber-500/10 text-xs text-amber-200 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-amber-100">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-300" />
                <span>Tienes campos pendientes o con formato inválido antes de enviar:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {([1, 2, 3, 4] as const)
                  .filter((s) => validation.stepErrorCounts[s] > 0)
                  .map((s) => {
                    const labels: Record<1 | 2 | 3 | 4, string> = {
                      1: '1. Solicitante',
                      2: '2. Laboral y Finanzas',
                      3: '3. Condiciones',
                      4: '4. Referencias',
                    };
                    const count = validation.stepErrorCounts[s];
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          markStepTouched(s);
                          goToStep(s);
                          focusField(validation.firstInvalidFieldByStep[s]);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-amber-400/15 hover:bg-amber-400/25 border border-amber-300/35 text-[11px] font-semibold text-amber-100 cursor-pointer transition-colors"
                      >
                        {labels[s]} ({count} {count === 1 ? 'campo' : 'campos'}) →
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          <div>
            <label
              className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer select-none transition-colors ${
                getFieldError('consentAccepted')
                  ? 'border-rose-400/60 bg-rose-500/10'
                  : consentAccepted
                    ? 'border-emerald-400/45 bg-emerald-500/[0.06]'
                    : 'border-white/12 bg-white/[0.02]'
              }`}
            >
              <input
                data-field="consentAccepted"
                type="checkbox"
                checked={consentAccepted}
                onChange={(e) => {
                  setConsentAccepted(e.target.checked);
                  markTouched('consentAccepted');
                }}
                aria-invalid={Boolean(getFieldError('consentAccepted'))}
                className="mt-0.5 rounded border-white/25 bg-[#030816]"
              />
              <span className="text-xs text-slate-200 leading-relaxed">
                Acepto expresamente los términos y autorizo el tratamiento de datos bajo la versión{' '}
                <strong className="font-mono text-white">{CONSENT_VERSION}</strong>.
              </span>
            </label>
            <FieldValidationFeedback variant="dark" error={getFieldError('consentAccepted')} />
          </div>
        </div>
      )}

      {/* Footer Navigation & Submit Controls */}
      <div className="pt-4 border-t border-white/10 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={() => goToStep((step - 1) as 1 | 2 | 3 | 4 | 5)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-xs font-semibold text-slate-200 cursor-pointer transition-colors whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Anterior</span>
              </button>
            )}
          </div>

          <div>
            {step < 5 ? (
              <button
                type="button"
                onClick={handleNextStep}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-white text-xs font-semibold shadow-lg hover:brightness-110 transition-all cursor-pointer whitespace-nowrap"
                style={{
                  background: `linear-gradient(135deg, ${instPrimary}, ${instAccent})`,
                }}
              >
                <span>Siguiente</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-xs font-semibold shadow-lg hover:brightness-110 transition-all disabled:opacity-50 cursor-pointer whitespace-nowrap"
                style={{
                  background: `linear-gradient(135deg, ${instPrimary}, ${instAccent})`,
                }}
              >
                {submitting ? (
                  <>
                    <FileCheck2 className="w-4 h-4 animate-pulse" />
                    <span>Enviando solicitud a {instName}...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Enviar Solicitud de Crédito</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Envío privado exclusivo para {instName}</span>
          </span>
          <button
            type="button"
            onClick={() => onSwitchToClientAuth('ingresar')}
            className="text-[#00D1FF] hover:underline font-medium cursor-pointer whitespace-nowrap"
          >
            ¿Ya tienes préstamo? Inicia sesión
          </button>
        </div>
      </div>
    </form>
  );
}
