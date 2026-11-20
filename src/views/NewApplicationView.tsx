import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Save, Send, Upload } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  DEFAULT_ORG_ID,
  generateId,
  saveBusinessUnique,
  saveCustomerUnique,
  submitOrSaveApplication,
  uploadDocumentRecord,
} from '../services/axycoreStore';
import {
  PRODUCT_LABELS,
  SCORING_STATUS_LABELS,
  formatMoney,
  formatRatePct,
  formatUserFacingError,
} from '../utils/formatters';
import {
  BiometricIdentityVerifier,
  type PendingIdentityFileItem,
} from '../components/BiometricIdentityVerifier';
import { OriginationLoanSimulator } from '../components/OriginationLoanSimulator';
import { BIOMETRIC_VERDICT_LABELS } from '../engine/biometricVerification';
import type { EngineEvaluationInput } from '../engine/decisionEngineV2';
import type {
  AdditionalIncomeStatus,
  AmortizationMethod,
  ApplicantType,
  ApplicationRecord,
  BiometricVerificationResult,
  CurrencyCode,
  DebtDeclarationStatus,
  HousingType,
  IncomeSourceType,
  PaymentFrequency,
  ProductCode,
  ScoringExecutionRecord,
  SocialMediaStatus,
} from '../types/axycore';

export function NewApplicationView() {
  const {
    userProfile,
    organization,
    customers,
    businesses,
    activeOrTestPolicy,
    externalPortalMode,
    setActiveSection,
    setSelectedApplicationId,
  } = useAxyCore();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultModal, setResultModal] = useState<{
    app: ApplicationRecord;
    scoring?: ScoringExecutionRecord;
    mode: 'DRAFT' | 'SUBMIT';
    docWarnings?: string[];
  } | null>(null);

  // Step 1: Applicant & Personal / Business Info
  const [channel, setChannel] = useState<'INTERNAL' | 'EXTERNAL'>(
    externalPortalMode || userProfile?.role === 'EXTERNAL_CLIENT' ? 'EXTERNAL' : 'INTERNAL'
  );
  const [applicantType, setApplicantType] = useState<ApplicantType>('INDIVIDUAL');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('NEW');
  const [documentType, setDocumentType] = useState<'CEDULA' | 'PASAPORTE'>('CEDULA');
  const [documentNumber, setDocumentNumber] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [nationality, setNationality] = useState('Dominicana');
  const [maritalStatus, setMaritalStatus] = useState('Soltero/a');
  const [phone, setPhone] = useState('');
  const [altPhone, setAltPhone] = useState('');
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
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('NEW');
  const [rnc, setRnc] = useState('');
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [companyType, setCompanyType] = useState('SRL');
  const [economicActivity, setEconomicActivity] = useState('');
  const [operationsStartDate, setOperationsStartDate] = useState('');
  const [authorizedRepName, setAuthorizedRepName] = useState('');
  const [authorizedRepDoc, setAuthorizedRepDoc] = useState('');
  const [corporateDocsSummary, setCorporateDocsSummary] = useState('');

  // Step 2: Labor & Financial Data
  const [activityType, setActivityType] = useState('Empleado privado');
  const [employerOrBusinessName, setEmployerOrBusinessName] = useState('');
  const [occupationOrRole, setOccupationOrRole] = useState('');
  const [employmentMonths, setEmploymentMonths] = useState<number>(24);
  const [incomeSourceType, setIncomeSourceType] = useState<IncomeSourceType>('FIJA_RECURRENTE');
  const [primaryNetIncome, setPrimaryNetIncome] = useState<string>('75000');
  const [additionalIncomeStatus, setAdditionalIncomeStatus] =
    useState<AdditionalIncomeStatus>('EXPLICIT_NONE');
  const [additionalNetIncome, setAdditionalNetIncome] = useState<string>('0');
  const [declaredTotalMonthlyIncome, setDeclaredTotalMonthlyIncome] = useState<string>('');
  const [incomeCurrency, setIncomeCurrency] = useState<CurrencyCode>('DOP');
  const [essentialExpenses, setEssentialExpenses] = useState<string>('28000');
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

  // Step 3: Requested Conditions
  const [productCode, setProductCode] = useState<ProductCode>('PERSONAL_DOP');
  const [requestedAmount, setRequestedAmount] = useState<string>('100000');
  const [requestedTermMonths, setRequestedTermMonths] = useState<string>('12');
  const [paymentFrequency, setPaymentFrequency] = useState<PaymentFrequency>('MENSUAL');
  const [amortizationMethod, setAmortizationMethod] = useState<AmortizationMethod>('SALDO_INSOLUTO');
  const [loanPurpose, setLoanPurpose] = useState('Capital / Consumo personal');
  const [loanPurposeDescription, setLoanPurposeDescription] = useState('');
  const [proposedCollateral, setProposedCollateral] = useState('');

  // Step 4: References & Documents
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
  const CONSENT_VERSION = 'v1.0-Ley172-13';

  const derivedCurrency: CurrencyCode = productCode.endsWith('USD') ? 'USD' : 'DOP';
  const activeProductPolicy = activeOrTestPolicy.products[productCode];

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.sessionStorage.getItem('axycore_calculator_origination_seed');
    if (!raw) return;
    try {
      const seed = JSON.parse(raw) as {
        productCode?: ProductCode;
        requestedAmount?: number;
        requestedTermMonths?: number;
        paymentFrequency?: PaymentFrequency;
        amortizationMethod?: AmortizationMethod;
      };
      if (seed.productCode && PRODUCT_LABELS[seed.productCode]) {
        setProductCode(seed.productCode);
        setApplicantType(seed.productCode.startsWith('EMPRESARIAL') ? 'BUSINESS' : 'INDIVIDUAL');
      }
      if (typeof seed.requestedAmount === 'number' && seed.requestedAmount > 0) {
        setRequestedAmount(String(seed.requestedAmount));
      }
      if (typeof seed.requestedTermMonths === 'number' && seed.requestedTermMonths > 0) {
        setRequestedTermMonths(String(seed.requestedTermMonths));
      }
      if (seed.paymentFrequency) {
        setPaymentFrequency(seed.paymentFrequency);
      }
      if (seed.amortizationMethod) {
        setAmortizationMethod(seed.amortizationMethod);
      }
    } catch {
      // Ignore invalid seed
    } finally {
      window.sessionStorage.removeItem('axycore_calculator_origination_seed');
    }
  }, []);

  const existingSelectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  const existingSelectedBusiness = useMemo(
    () => businesses.find((b) => b.id === selectedBusinessId) ?? null,
    [businesses, selectedBusinessId]
  );

  const parseDraftNumOrNull = (val: string): number | null => {
    if (val.trim() === '') return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  };

  const simulatorDraftData = useMemo<{
    application: EngineEvaluationInput['application'];
    customer: EngineEvaluationInput['customer'];
  }>(() => {
    const references = [
      ref1Name.trim() || ref1Phone.trim()
        ? { name: ref1Name.trim(), relationship: ref1Rel.trim(), phone: ref1Phone.trim() }
        : null,
      ref2Name.trim() || ref2Phone.trim()
        ? { name: ref2Name.trim(), relationship: ref2Rel.trim(), phone: ref2Phone.trim() }
        : null,
    ].filter((r): r is NonNullable<typeof r> => r !== null);

    const effectiveOrgId = userProfile?.organizationId || organization?.id || DEFAULT_ORG_ID;
    const reqAmtNum = Number(requestedAmount);
    const reqTermNum = Number(requestedTermMonths);

    return {
      customer: {
        phone: phone.trim(),
        address: address.trim(),
        email: email.trim(),
        residenceMonths: Number(residenceMonths) || 0,
        housingType,
        housingPayment: Number(housingPayment) || 0,
        socialMediaDeclared,
        socialMediaHandle: socialMediaHandle.trim(),
      },
      application: {
        id: 'origination_draft_sim',
        organizationId: effectiveOrgId,
        applicantType,
        productCode,
        currency: derivedCurrency,
        requestedAmount: Number.isFinite(reqAmtNum) ? Math.max(0, reqAmtNum) : 0,
        requestedTermMonths: Number.isFinite(reqTermNum) ? Math.max(0, Math.round(reqTermNum)) : 0,
        paymentFrequency,
        amortizationMethod,
        loanPurpose: loanPurpose.trim(),
        loanPurposeDescription: loanPurposeDescription.trim(),
        financialData: {
          activityType,
          employerOrBusinessName: employerOrBusinessName.trim(),
          occupationOrRole: occupationOrRole.trim(),
          employmentMonths: Number(employmentMonths) || 0,
          incomeSourceType,
          primaryNetIncome: parseDraftNumOrNull(primaryNetIncome),
          additionalIncomeStatus,
          additionalNetIncome: parseDraftNumOrNull(additionalNetIncome) ?? 0,
          declaredTotalMonthlyIncome: parseDraftNumOrNull(declaredTotalMonthlyIncome),
          incomeCurrency,
          essentialExpenses: parseDraftNumOrNull(essentialExpenses),
          housingPayment: Number(housingPayment) || 0,
          housingIncludedInExpenses,
          debtDeclarationStatus,
          debtCount: parseDraftNumOrNull(debtCount),
          totalDebtBalance: parseDraftNumOrNull(totalDebtBalance),
          currentDebtPayments: parseDraftNumOrNull(currentDebtPayments),
          bankDebtPayment: parseDraftNumOrNull(bankDebtPayment),
          financeDebtPayment: parseDraftNumOrNull(financeDebtPayment),
          cardDebtPayment: parseDraftNumOrNull(cardDebtPayment),
          informalDebtPayment: parseDraftNumOrNull(informalDebtPayment),
          otherDebtPayment: parseDraftNumOrNull(otherDebtPayment),
        },
        businessFinancialData:
          applicantType === 'BUSINESS'
            ? {
                grossSales: parseDraftNumOrNull(grossSales),
                operatingCosts: parseDraftNumOrNull(operatingCosts),
                netMonthlyFlow: parseDraftNumOrNull(netMonthlyFlow),
                businessObligationsMonthly: parseDraftNumOrNull(currentDebtPayments),
                totalBusinessDebtBalance: parseDraftNumOrNull(totalDebtBalance),
                businessDebtCount: parseDraftNumOrNull(debtCount),
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
      },
    };
  }, [
    userProfile?.organizationId,
    organization?.id,
    phone,
    address,
    email,
    residenceMonths,
    housingType,
    housingPayment,
    socialMediaDeclared,
    socialMediaHandle,
    applicantType,
    productCode,
    derivedCurrency,
    requestedAmount,
    requestedTermMonths,
    paymentFrequency,
    amortizationMethod,
    loanPurpose,
    loanPurposeDescription,
    activityType,
    employerOrBusinessName,
    occupationOrRole,
    employmentMonths,
    incomeSourceType,
    primaryNetIncome,
    additionalIncomeStatus,
    additionalNetIncome,
    declaredTotalMonthlyIncome,
    incomeCurrency,
    essentialExpenses,
    housingIncludedInExpenses,
    debtDeclarationStatus,
    debtCount,
    totalDebtBalance,
    currentDebtPayments,
    bankDebtPayment,
    financeDebtPayment,
    cardDebtPayment,
    informalDebtPayment,
    otherDebtPayment,
    grossSales,
    operatingCosts,
    netMonthlyFlow,
    repaymentSource,
    ref1Name,
    ref1Rel,
    ref1Phone,
    ref2Name,
    ref2Rel,
    ref2Phone,
    hasIdentityDoc,
    hasIncomeEvidence,
  ]);

  const handleSelectExistingCustomer = (cid: string) => {
    setSelectedCustomerId(cid);
    const c = customers.find((x) => x.id === cid);
    if (c) {
      setDocumentType(c.documentType);
      setDocumentNumber(c.documentNumber);
      setFirstName(c.firstName);
      setLastName(c.lastName);
      setPhone(c.phone);
      setEmail(c.email ?? '');
      setAddress(c.address ?? '');
      setResidenceMonths(c.residenceMonths ?? 0);
      setHousingType(c.housingType ?? 'NO_DECLARADA');
      setHousingPayment(c.housingPayment ?? 0);
      setSocialMediaDeclared(c.socialMediaDeclared ?? 'UNANSWERED');
      setSocialMediaHandle(c.socialMediaHandle ?? '');
    }
  };

  const handleFileAttach = async (category: string, file: File | null) => {
    if (!file) return;
    if (file.size > 450 * 1024) {
      setErrorMsg('Para almacenamiento directo seguro, el archivo no debe superar 450 KB.');
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
    setPendingFiles((prev) => [
      ...prev.filter((f) => f.category !== 'Verificacion_Biometrica'),
      {
        category: 'Verificacion_Biometrica',
        fileName: capture.fileName,
        mimeType: capture.mimeType,
        sizeBytes: capture.sizeBytes,
        fileDataUrl: capture.fileDataUrl,
        notes: capture.notes,
      },
    ]);
    if (capture.result.verdict === 'COINCIDE') {
      setHasIdentityDoc(true);
    }
  };

  const handlePersist = async (mode: 'DRAFT' | 'SUBMIT') => {
    if (!userProfile) return;
    setErrorMsg(null);

    if (mode === 'SUBMIT' && !consentAccepted) {
      setErrorMsg('El solicitante debe aceptar los términos y la autorización de datos (Ley 172-13) antes de enviar.');
      return;
    }
    if (!firstName.trim() || !lastName.trim() || !documentNumber.trim() || !phone.trim()) {
      setErrorMsg('Complete los datos de identificación mínimos del solicitante (Nombres, Apellidos, Documento y Teléfono).');
      return;
    }

    const parsedAmount = Number(requestedAmount);
    const parsedTerm = Number(requestedTermMonths);
    if (mode === 'SUBMIT') {
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || parsedAmount > 100_000_000) {
        setErrorMsg('El monto solicitado debe ser mayor que 0 y no superar 100,000,000.');
        return;
      }
      if (!Number.isFinite(parsedTerm) || parsedTerm < 1 || parsedTerm > 360) {
        setErrorMsg('El plazo solicitado debe estar entre 1 y 360 meses.');
        return;
      }
    }

    const effectiveOrgId = userProfile.organizationId || organization?.id || DEFAULT_ORG_ID;
    const safeDisplayName = (userProfile.displayName || userProfile.email || 'Solicitante')
      .trim()
      .slice(0, 160);
    const safeAmount = Number.isFinite(parsedAmount)
      ? Math.min(100_000_000, Math.max(0, parsedAmount))
      : 0;
    const safeTerm = Number.isFinite(parsedTerm)
      ? Math.min(360, Math.max(0, Math.round(parsedTerm)))
      : 0;

    setSubmitting(true);
    try {
      let customer = existingSelectedCustomer;
      if (!customer) {
        customer = await saveCustomerUnique({
          organizationId: effectiveOrgId,
          documentType,
          documentNumber,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          birthDate,
          nationality,
          maritalStatus,
          phone: phone.trim(),
          altPhone: altPhone.trim(),
          email: email.trim(),
          address: address.trim(),
          municipality: municipality.trim(),
          province: province.trim(),
          residenceMonths: Number(residenceMonths) || 0,
          housingType,
          housingPayment: Number(housingPayment) || 0,
          socialMediaDeclared,
          socialMediaHandle: socialMediaHandle.trim(),
          altContactName: altContactName.trim(),
          altContactPhone: altContactPhone.trim(),
          createdBy: userProfile.uid,
        });
      }

      let businessId: string | null = null;
      if (applicantType === 'BUSINESS') {
        if (existingSelectedBusiness) {
          businessId = existingSelectedBusiness.id;
        } else {
          if (!rnc.trim() || !legalName.trim() || !authorizedRepName.trim()) {
            throw new Error('Para solicitudes empresariales debe completar RNC, Razón Social y Representante Autorizado.');
          }
          const biz = await saveBusinessUnique({
            organizationId: effectiveOrgId,
            rnc: rnc.trim(),
            legalName: legalName.trim(),
            tradeName: tradeName.trim(),
            companyType,
            economicActivity,
            operationsStartDate,
            authorizedRepName: authorizedRepName.trim(),
            authorizedRepDoc: authorizedRepDoc.trim(),
            corporateDocsSummary: corporateDocsSummary.trim(),
            createdBy: userProfile.uid,
          });
          businessId = biz.id;
        }
      }

      const appId = generateId('app');
      const seq = String(Date.now()).slice(-6);
      const appNum = `SOL-2026-${seq}`;
      const fileNum = `EXP-2026-${seq}`;

      const parseNumOrNull = (val: string): number | null => {
        if (val.trim() === '') return null;
        const n = Number(val);
        return Number.isFinite(n) ? n : null;
      };

      const references = [
        ref1Name.trim() || ref1Phone.trim()
          ? { name: ref1Name.trim(), relationship: ref1Rel.trim(), phone: ref1Phone.trim() }
          : null,
        ref2Name.trim() || ref2Phone.trim()
          ? { name: ref2Name.trim(), relationship: ref2Rel.trim(), phone: ref2Phone.trim() }
          : null,
      ].filter((r): r is NonNullable<typeof r> => r !== null);

      const rawDisplayName =
        applicantType === 'BUSINESS'
          ? `${tradeName || legalName} (${firstName} ${lastName})`
          : `${firstName} ${lastName}`;

      const appRecord: ApplicationRecord = {
        id: appId,
        organizationId: effectiveOrgId,
        applicationNumber: appNum,
        fileNumber: fileNum,
        channel: externalPortalMode || userProfile.role === 'EXTERNAL_CLIENT' ? 'EXTERNAL' : channel,
        applicantType,
        customerId: customer.id,
        businessId,
        applicantDisplayName: rawDisplayName.trim().slice(0, 200),
        productCode,
        currency: derivedCurrency,
        requestedAmount: safeAmount,
        requestedTermMonths: safeTerm,
        paymentFrequency: activeProductPolicy?.allowedFrequencies.includes(paymentFrequency)
          ? paymentFrequency
          : activeProductPolicy?.allowedFrequencies[0] ?? 'MENSUAL',
        amortizationMethod: activeProductPolicy?.allowedAmortizationMethods.includes(
          amortizationMethod
        )
          ? amortizationMethod
          : activeProductPolicy?.allowedAmortizationMethods[0] ?? 'SALDO_INSOLUTO',
        loanPurpose: loanPurpose.trim().slice(0, 120),
        loanPurposeDescription: loanPurposeDescription.trim().slice(0, 1000),
        proposedCollateral: proposedCollateral.trim().slice(0, 500),
        financialData: {
          activityType,
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
        status: mode === 'DRAFT' ? 'BORRADOR' : 'RECIBIDA',
        consentVersion: CONSENT_VERSION,
        consentAcceptedAt: new Date().toISOString(),
        createdBy: userProfile.uid,
        createdByName: safeDisplayName,
      };

      const saved = await submitOrSaveApplication({
        application: appRecord,
        customer,
        policy: activeOrTestPolicy,
        mode,
        user: userProfile,
      });

      // Persist attached documents without failing the already-saved application
      const docWarnings: string[] = [];
      for (const pf of pendingFiles) {
        try {
          await uploadDocumentRecord(
            {
              id: generateId('doc'),
              organizationId: effectiveOrgId,
              applicationId: appId,
              category: pf.category,
              fileName: pf.fileName,
              mimeType: pf.mimeType,
              sizeBytes: pf.sizeBytes,
              fileDataUrl: pf.fileDataUrl,
              notes: pf.notes,
              reviewStatus: 'RECIBIDO',
              uploadedBy: userProfile.uid,
              uploadedByName: safeDisplayName,
            },
            userProfile
          );
        } catch (docErr) {
          console.warn('No se pudo adjuntar documento tras guardar solicitud:', pf.fileName, docErr);
          docWarnings.push(pf.fileName);
        }
      }

      setResultModal({
        app: saved.application,
        scoring: saved.scoring,
        mode,
        docWarnings: docWarnings.length > 0 ? docWarnings : undefined,
      });
    } catch (err) {
      setErrorMsg(
        formatUserFacingError(
          err,
          'No se pudo enviar la solicitud de crédito. Intente nuevamente.'
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (resultModal) {
    const { app, scoring, mode, docWarnings } = resultModal;
    const isPortalClient = externalPortalMode || userProfile?.role === 'EXTERNAL_CLIENT';
    return (
      <div className="axy-surface axy-panel-in max-w-3xl mx-auto p-6 sm:p-8 rounded-2xl space-y-6">
        <div className="flex items-center gap-3 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-7 h-7" />
          <div>
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              {mode === 'DRAFT' ? 'Borrador guardado correctamente' : 'Solicitud registrada y evaluada por Motor V2'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              {app.applicationNumber} · {app.fileNumber} · Canal {app.channel}
            </p>
          </div>
        </div>

        {docWarnings && docWarnings.length > 0 && (
          <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-800 dark:text-amber-300">
            Tu solicitud fue registrada correctamente, pero no se pudieron adjuntar los siguientes archivos ({docWarnings.join(', ')}). Podrás cargarlos más adelante desde el expediente.
          </div>
        )}

        {scoring && (
          <div className="axy-surface-tonal grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Score Interno V2</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">{scoring.totalScore}/100</p>
              <p className="text-xs text-slate-600 dark:text-slate-300">{scoring.riskBand.label}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Precalificación</p>
              <p className="text-sm font-semibold text-[#0066FF] dark:text-[#00D1FF] mt-1">
                {SCORING_STATUS_LABELS[scoring.status]}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Monto Recomendado</p>
              <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {formatMoney(scoring.recommendedAmount, app.currency)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Tasa y Cuota Est.</p>
              <p className="text-sm font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                {formatRatePct(scoring.recommendedRateMonthly)} / mes
              </p>
              <p className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                {formatMoney(scoring.recommendedInstallment, app.currency)}
              </p>
            </div>
          </div>
        )}

        <p className="text-xs text-slate-500 dark:text-slate-400">
          {isPortalClient
            ? 'Importante: La precalificación preliminar del Motor V2 no constituye aprobación contractual automática. Puedes consultar el avance de tu solicitud desde el Portal de Clientes.'
            : 'Importante: La precalificación preliminar del Motor V2 no constituye aprobación contractual automática. El expediente queda disponible en Solicitudes Recibidas para evaluación y comité.'}
        </p>

        <div className="flex flex-wrap gap-3">
          {isPortalClient ? (
            <button
              type="button"
              onClick={() => {
                setActiveSection('loans');
              }}
              className="axy-btn-primary px-4 py-2 text-sm cursor-pointer"
            >
              Volver al Portal de Clientes
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSelectedApplicationId(app.id);
                setActiveSection('applications');
              }}
              className="axy-btn-primary px-4 py-2 text-sm cursor-pointer"
            >
              Ver en Solicitudes Recibidas
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setResultModal(null);
              setStep(1);
            }}
            className="axy-btn-secondary px-4 py-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            Crear otra solicitud
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            Originación de Solicitud de Préstamo
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Canal: {channel === 'EXTERNAL' ? 'Externo (Portal Web)' : 'Interno (Oficial / Consola)'} · Ejecución automática del Motor V2 al enviar
          </p>
        </div>
        {userProfile?.role !== 'EXTERNAL_CLIENT' && (
          <div className="axy-surface-tonal flex items-center gap-1 p-1 rounded-xl text-xs">
            <button
              type="button"
              onClick={() => setChannel('INTERNAL')}
              className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-colors ${
                channel === 'INTERNAL' ? 'bg-[#0066FF] text-white shadow-sm' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Canal Interno
            </button>
            <button
              type="button"
              onClick={() => setChannel('EXTERNAL')}
              className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-colors ${
                channel === 'EXTERNAL' ? 'bg-[#0066FF] text-white shadow-sm' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Canal Externo
            </button>
          </div>
        )}
      </div>

      {/* Stepper */}
      <div className="grid grid-cols-5 gap-2">
        {[
          [1, '1. Solicitante'],
          [2, '2. Laboral y Finanzas'],
          [3, '3. Condiciones'],
          [4, '4. Referencias y Docs'],
          [5, '5. Consentimiento'],
        ].map(([num, label]) => (
          <button
            key={num}
            type="button"
            onClick={() => setStep(num as typeof step)}
            className={`py-2.5 px-3 rounded-xl border text-xs font-medium text-left truncate cursor-pointer transition-colors ${
              step === num
                ? 'border-[#0066FF] bg-[#0066FF]/[0.08] dark:bg-[#0066FF]/20 text-[#0066FF] dark:text-[#00D1FF] font-semibold'
                : 'axy-surface text-slate-600 dark:text-slate-400 hover:bg-slate-50/70 dark:hover:bg-white/[0.04]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
          {errorMsg}
        </div>
      )}

      <div className="axy-surface p-6 rounded-2xl space-y-6">
        {step === 1 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Tipo de Solicitud</label>
                <select
                  value={applicantType}
                  onChange={(e) => {
                    const t = e.target.value as ApplicantType;
                    setApplicantType(t);
                    setProductCode(t === 'BUSINESS' ? 'EMPRESARIAL_DOP' : 'PERSONAL_DOP');
                  }}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  <option value="INDIVIDUAL">Persona Física (Individual)</option>
                  <option value="BUSINESS">Persona Jurídica / Empresa</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Cliente Existente o Nuevo</label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => handleSelectExistingCustomer(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  <option value="NEW">+ Registrar nuevo solicitante</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName} ({c.documentNumber})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Tipo Documento *</label>
                <select
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value as 'CEDULA' | 'PASAPORTE')}
                  disabled={selectedCustomerId !== 'NEW'}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  <option value="CEDULA">Cédula</option>
                  <option value="PASAPORTE">Pasaporte</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Número de Documento *</label>
                <input
                  value={documentNumber}
                  onChange={(e) => setDocumentNumber(e.target.value)}
                  disabled={selectedCustomerId !== 'NEW'}
                  placeholder="001-0000000-0"
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Fecha de Nacimiento</label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Nombres *</label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Apellidos *</label>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Teléfono Principal *</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="809-555-0000"
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Nacionalidad (no puntúa en scoring)</label>
                <input
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Estado Civil (no puntúa en scoring)</label>
                <input
                  value={maritalStatus}
                  onChange={(e) => setMaritalStatus(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Correo Electrónico (opcional)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Dirección Residencial</label>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Municipio / Provincia</label>
                <input
                  value={`${municipality}${province ? `, ${province}` : ''}`}
                  onChange={(e) => {
                    const [m, p] = e.target.value.split(',');
                    setMunicipality(m ?? '');
                    setProvince((p ?? '').trim());
                  }}
                  placeholder="Santo Domingo, DN"
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Tiempo de Residencia (meses)</label>
                <input
                  type="number"
                  min={0}
                  value={residenceMonths}
                  onChange={(e) => setResidenceMonths(Number(e.target.value))}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Tipo de Vivienda</label>
                <select
                  value={housingType}
                  onChange={(e) => setHousingType(e.target.value as HousingType)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  <option value="PROPIA">Propia</option>
                  <option value="ALQUILADA">Alquilada</option>
                  <option value="FAMILIAR">Familiar</option>
                  <option value="OTRA">Otra</option>
                  <option value="NO_DECLARADA">No declarada</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Pago Mensual de Vivienda</label>
                <input
                  type="number"
                  min={0}
                  value={housingPayment}
                  onChange={(e) => setHousingPayment(Number(e.target.value))}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2 border-t border-[var(--axy-border)]">
              <div>
                <label className="block text-xs font-medium mb-1">Redes Sociales (Equidad en revisión)</label>
                <select
                  value={socialMediaDeclared}
                  onChange={(e) => setSocialMediaDeclared(e.target.value as SocialMediaStatus)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  <option value="YES">Sí tiene</option>
                  <option value="NO_MEDIA">Declara no tener</option>
                  <option value="UNANSWERED">Prefiere no responder</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Usuario / Handle</label>
                <input
                  value={socialMediaHandle}
                  onChange={(e) => setSocialMediaHandle(e.target.value)}
                  disabled={socialMediaDeclared !== 'YES'}
                  placeholder="@usuario"
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Contacto Alternativo (Nombre)</label>
                <input
                  value={altContactName}
                  onChange={(e) => setAltContactName(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Contacto Alternativo (Tel.)</label>
                <input
                  value={altContactPhone}
                  onChange={(e) => setAltContactPhone(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                />
              </div>
            </div>

            {applicantType === 'BUSINESS' && (
              <div className="pt-4 border-t border-[var(--axy-border)] space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Datos Societarios de la Empresa</h3>
                  <select
                    value={selectedBusinessId}
                    onChange={(e) => setSelectedBusinessId(e.target.value)}
                    className="text-xs axy-input px-2.5 py-1.5 text-slate-900 dark:text-white"
                  >
                    <option value="NEW">+ Nueva Empresa</option>
                    {businesses.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.legalName} (RNC {b.rnc})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1">RNC *</label>
                    <input
                      value={rnc}
                      onChange={(e) => setRnc(e.target.value)}
                      className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Razón Social *</label>
                    <input
                      value={legalName}
                      onChange={(e) => setLegalName(e.target.value)}
                      className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Nombre Comercial</label>
                    <input
                      value={tradeName}
                      onChange={(e) => setTradeName(e.target.value)}
                      className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Tipo de Empresa</label>
                    <input
                      value={companyType}
                      onChange={(e) => setCompanyType(e.target.value)}
                      className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Actividad Económica</label>
                    <input
                      value={economicActivity}
                      onChange={(e) => setEconomicActivity(e.target.value)}
                      className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Inicio de Operaciones</label>
                    <input
                      type="date"
                      value={operationsStartDate}
                      onChange={(e) => setOperationsStartDate(e.target.value)}
                      className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Representante Autorizado *</label>
                    <input
                      value={authorizedRepName}
                      onChange={(e) => setAuthorizedRepName(e.target.value)}
                      className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Doc. Representante</label>
                    <input
                      value={authorizedRepDoc}
                      onChange={(e) => setAuthorizedRepDoc(e.target.value)}
                      className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Documentación Societaria</label>
                    <input
                      value={corporateDocsSummary}
                      onChange={(e) => setCorporateDocsSummary(e.target.value)}
                      placeholder="Registro mercantil, acta, RNC"
                      className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Tipo de Actividad</label>
                <input
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Empresa o Negocio</label>
                <input
                  value={employerOrBusinessName}
                  onChange={(e) => setEmployerOrBusinessName(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Cargo u Ocupación</label>
                <input
                  value={occupationOrRole}
                  onChange={(e) => setOccupationOrRole(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Antigüedad Laboral/Comercial (meses)</label>
                <input
                  type="number"
                  min={0}
                  value={employmentMonths}
                  onChange={(e) => setEmploymentMonths(Number(e.target.value))}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Fuente de Ingresos</label>
                <select
                  value={incomeSourceType}
                  onChange={(e) => setIncomeSourceType(e.target.value as IncomeSourceType)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  <option value="FIJA_RECURRENTE">Fija o recurrente</option>
                  <option value="MIXTA_RECURRENTE">Mixta recurrente</option>
                  <option value="IRREGULAR">Irregular</option>
                  <option value="SIN_INGRESOS">Sin ingresos</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Moneda de los Ingresos</label>
                <select
                  value={incomeCurrency}
                  onChange={(e) => setIncomeCurrency(e.target.value as CurrencyCode)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  <option value="DOP">DOP (Pesos Dominicanos)</option>
                  <option value="USD">USD (Dólares Estadounidenses)</option>
                </select>
              </div>
            </div>

            {applicantType === 'BUSINESS' ? (
              <div className="axy-surface-tonal p-4 rounded-xl space-y-4">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-white">
                  Flujo Empresarial (No confundir ventas brutas con flujo neto disponible)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1">Ventas Brutas Mensuales</label>
                    <input
                      type="number"
                      value={grossSales}
                      onChange={(e) => setGrossSales(e.target.value)}
                      className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Costos Operativos</label>
                    <input
                      type="number"
                      value={operatingCosts}
                      onChange={(e) => setOperatingCosts(e.target.value)}
                      className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Flujo Neto Mensual Disponible *</label>
                    <input
                      type="number"
                      value={netMonthlyFlow}
                      onChange={(e) => setNetMonthlyFlow(e.target.value)}
                      className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Origen Principal del Repago</label>
                    <input
                      value={repaymentSource}
                      onChange={(e) => setRepaymentSource(e.target.value)}
                      className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Ingreso Principal Neto Mensual</label>
                  <input
                    type="number"
                    value={primaryNetIncome}
                    onChange={(e) => setPrimaryNetIncome(e.target.value)}
                    className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Estado Ingresos Adicionales</label>
                  <select
                    value={additionalIncomeStatus}
                    onChange={(e) => {
                      const s = e.target.value as AdditionalIncomeStatus;
                      setAdditionalIncomeStatus(s);
                      if (s === 'EXPLICIT_NONE') setAdditionalNetIncome('0');
                    }}
                    className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                  >
                    <option value="EXPLICIT_NONE">Declara expresamente no tener</option>
                    <option value="QUANTIFIED">Cuantificados (ponderan 70%)</option>
                    <option value="PARTIAL">Declaración parcial</option>
                    <option value="INCONSISTENT">Inconsistente</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Ingresos Adicionales Netos</label>
                  <input
                    type="number"
                    value={additionalNetIncome}
                    onChange={(e) => setAdditionalNetIncome(e.target.value)}
                    disabled={additionalIncomeStatus === 'EXPLICIT_NONE'}
                    className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Ingreso Total Declarado (control)</label>
                  <input
                    type="number"
                    value={declaredTotalMonthlyIncome}
                    onChange={(e) => setDeclaredTotalMonthlyIncome(e.target.value)}
                    placeholder="Opcional para conciliación"
                    className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[var(--axy-border)]">
              <div>
                <label className="block text-xs font-medium mb-1">Gastos Esenciales Mensuales (sin cuotas de deuda)</label>
                <input
                  type="number"
                  value={essentialExpenses}
                  onChange={(e) => setEssentialExpenses(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={housingIncludedInExpenses}
                    onChange={(e) => setHousingIncludedInExpenses(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-600 dark:bg-slate-800"
                  />
                  <span>El pago de vivienda ya está incluido dentro de los gastos esenciales (evitar doble descuento)</span>
                </label>
              </div>
            </div>

            <div className="pt-2 border-t border-[var(--axy-border)] space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Declaración de Deudas</label>
                  <select
                    value={debtDeclarationStatus}
                    onChange={(e) => {
                      const s = e.target.value as DebtDeclarationStatus;
                      setDebtDeclarationStatus(s);
                      if (s === 'NO_DEBTS_EXPLICIT') {
                        setDebtCount('0');
                        setTotalDebtBalance('0');
                        setCurrentDebtPayments('0');
                      }
                    }}
                    className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                  >
                    <option value="NO_DEBTS_EXPLICIT">Declara expresamente CERO deudas</option>
                    <option value="HAS_DEBTS">Posee deudas activas</option>
                    <option value="UNDECLARED">Información no suministrada</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Cantidad de Deudas</label>
                  <input
                    type="number"
                    value={debtCount}
                    onChange={(e) => setDebtCount(e.target.value)}
                    disabled={debtDeclarationStatus !== 'HAS_DEBTS'}
                    className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Saldo Total Adeudado</label>
                  <input
                    type="number"
                    value={totalDebtBalance}
                    onChange={(e) => setTotalDebtBalance(e.target.value)}
                    disabled={debtDeclarationStatus !== 'HAS_DEBTS'}
                    className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Cuotas Mensuales Totales (D)</label>
                  <input
                    type="number"
                    value={currentDebtPayments}
                    onChange={(e) => setCurrentDebtPayments(e.target.value)}
                    disabled={debtDeclarationStatus !== 'HAS_DEBTS'}
                    className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              {debtDeclarationStatus === 'HAS_DEBTS' && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                  <div>
                    <label className="block mb-1 text-slate-500">Cuota Bancos</label>
                    <input
                      type="number"
                      value={bankDebtPayment}
                      onChange={(e) => setBankDebtPayment(e.target.value)}
                      className="w-full axy-input px-2.5 py-1.5 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Cuota Financieras</label>
                    <input
                      type="number"
                      value={financeDebtPayment}
                      onChange={(e) => setFinanceDebtPayment(e.target.value)}
                      className="w-full axy-input px-2.5 py-1.5 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Cuota Tarjetas</label>
                    <input
                      type="number"
                      value={cardDebtPayment}
                      onChange={(e) => setCardDebtPayment(e.target.value)}
                      className="w-full axy-input px-2.5 py-1.5 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Préstamos Informales</label>
                    <input
                      type="number"
                      value={informalDebtPayment}
                      onChange={(e) => setInformalDebtPayment(e.target.value)}
                      className="w-full axy-input px-2.5 py-1.5 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Otras Obligaciones</label>
                    <input
                      type="number"
                      value={otherDebtPayment}
                      onChange={(e) => setOtherDebtPayment(e.target.value)}
                      className="w-full axy-input px-2.5 py-1.5 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Producto / Tipo de Préstamo</label>
                <select
                  value={productCode}
                  onChange={(e) => setProductCode(e.target.value as ProductCode)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  {Object.entries(PRODUCT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Monto Solicitado ({derivedCurrency})</label>
                <input
                  type="number"
                  value={requestedAmount}
                  onChange={(e) => setRequestedAmount(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono tabular-nums"
                />
                {activeProductPolicy && (
                  <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                    Política V2: {formatMoney(activeProductPolicy.minAmount, derivedCurrency)} –{' '}
                    {formatMoney(activeProductPolicy.maxAmount, derivedCurrency)}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Plazo Solicitado (Meses)</label>
                <input
                  type="number"
                  value={requestedTermMonths}
                  onChange={(e) => setRequestedTermMonths(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono tabular-nums"
                />
                {activeProductPolicy && (
                  <p className="text-[11px] text-slate-500 mt-1 font-mono tabular-nums">
                    Política V2: {activeProductPolicy.minTermMonths}–{activeProductPolicy.maxTermMonths} meses
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Frecuencia de Pago</label>
                <select
                  value={paymentFrequency}
                  onChange={(e) => setPaymentFrequency(e.target.value as PaymentFrequency)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  {(activeProductPolicy?.allowedFrequencies ?? ['MENSUAL']).map((freq) => (
                    <option key={freq} value={freq}>
                      {freq === 'MENSUAL'
                        ? 'Mensual (Política activa Motor V2)'
                        : freq === 'QUINCENAL'
                        ? 'Quincenal'
                        : 'Semanal'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Destino del Financiamiento</label>
                <input
                  value={loanPurpose}
                  onChange={(e) => setLoanPurpose(e.target.value)}
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Garantía Propuesta (si aplica)</label>
                <input
                  value={proposedCollateral}
                  onChange={(e) => setProposedCollateral(e.target.value)}
                  placeholder="Vehículo, hipoteca, fianza solidaria..."
                  className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Descripción Detallada del Destino</label>
              <textarea
                rows={2}
                value={loanPurposeDescription}
                onChange={(e) => setLoanPurposeDescription(e.target.value)}
                placeholder="Detalle en qué se invertirán o utilizarán los fondos..."
                className="w-full axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <OriginationLoanSimulator
              policy={activeOrTestPolicy}
              draftApplication={simulatorDraftData.application}
              draftCustomer={simulatorDraftData.customer}
              onApplyConditions={(updates) => {
                if (updates.requestedAmount !== undefined) {
                  setRequestedAmount(String(updates.requestedAmount));
                }
                if (updates.requestedTermMonths !== undefined) {
                  setRequestedTermMonths(String(updates.requestedTermMonths));
                }
                if (updates.paymentFrequency !== undefined) {
                  setPaymentFrequency(updates.paymentFrequency);
                }
                if (updates.amortizationMethod !== undefined) {
                  setAmortizationMethod(updates.amortizationMethod);
                }
              }}
            />
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Referencias Personales / Comerciales (no requieren llamada previa al scoring)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  placeholder="Referencia 1: Nombre completo"
                  value={ref1Name}
                  onChange={(e) => setRef1Name(e.target.value)}
                  className="axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
                <input
                  placeholder="Relación (Ej. Hermano, Proveedor)"
                  value={ref1Rel}
                  onChange={(e) => setRef1Rel(e.target.value)}
                  className="axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
                <input
                  placeholder="Teléfono"
                  value={ref1Phone}
                  onChange={(e) => setRef1Phone(e.target.value)}
                  className="axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  placeholder="Referencia 2: Nombre completo"
                  value={ref2Name}
                  onChange={(e) => setRef2Name(e.target.value)}
                  className="axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
                <input
                  placeholder="Relación"
                  value={ref2Rel}
                  onChange={(e) => setRef2Rel(e.target.value)}
                  className="axy-input px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
                <input
                  placeholder="Teléfono"
                  value={ref2Phone}
                  onChange={(e) => setRef2Phone(e.target.value)}
                  className="axy-input px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200/80 dark:border-[#00B8FF]/15 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Documentos Suministrados en Expediente</h3>
              <div className="flex flex-wrap gap-6 text-xs">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="axy-surface-tonal p-4 rounded-xl border-dashed border-[#0066FF]/35 dark:border-[#00B8FF]/35 flex items-center gap-3 text-xs cursor-pointer hover:border-[#0066FF] transition-colors">
                  <Upload className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                  <span>Adjuntar Cédula / Identidad (máx. 450KB)</span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => handleFileAttach('Identidad', e.target.files?.[0] ?? null)}
                  />
                </label>
                <label className="axy-surface-tonal p-4 rounded-xl border-dashed border-[#0066FF]/35 dark:border-[#00B8FF]/35 flex items-center gap-3 text-xs cursor-pointer hover:border-[#0066FF] transition-colors">
                  <Upload className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                  <span>Adjuntar Evidencia de Ingresos (máx. 450KB)</span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => handleFileAttach('Ingresos', e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              {pendingFiles.length > 0 && (
                <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  {pendingFiles.map((f, idx) => (
                    <li key={`${f.category}-${f.fileName}-${idx}`} className="font-mono flex items-center justify-between gap-2">
                      <span className="truncate">
                        [{f.category}] {f.fileName} ({Math.round(f.sizeBytes / 1024)} KB)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingFiles((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-[11px] font-sans text-rose-600 hover:underline shrink-0 cursor-pointer"
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
                onAttachIdentityFile={(file) => handleFileAttach('Identidad', file)}
                onSaveBiometricCapture={handleSaveBiometricCapture}
                onBiometricResultChange={setBiometricResult}
              />
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-5">
            {biometricResult && (
              <div className="axy-surface-ai p-3.5 rounded-xl text-xs flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    Verificación Biométrica (Cámara + Visión IA):{' '}
                  </span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {BIOMETRIC_VERDICT_LABELS[biometricResult.verdict]}
                  </span>
                </div>
                <span className="font-mono tabular-nums font-bold text-[#0066FF] dark:text-[#00D1FF]">
                  Similitud {biometricResult.similarityScore}% · Liveness {biometricResult.livenessAssessment}
                </span>
              </div>
            )}

            <div className="axy-surface-tonal p-4 rounded-xl space-y-2 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              <p className="font-semibold text-slate-900 dark:text-white">
                Términos y Autorización de Tratamiento de Datos — Ley 172-13 ({CONSENT_VERSION})
              </p>
              <p>
                Declaro bajo fe de juramento que la información personal, laboral, financiera y de obligaciones suministrada en esta solicitud es verídica y comprobable. Autorizo expresamente a la entidad financiera operadora de AxyCore al tratamiento de mis datos personales y crediticios para fines de evaluación de riesgo, cumplimiento regulatorio, formalización contractual y administración de cartera, conforme a la Ley No. 172-13 de la República Dominicana.
              </p>
              <p>
                Comprendo que el resultado emitido inmediatamente tras el envío constituye una precalificación preliminar y no equivale a una aprobación definitiva ni a un desembolso automático.
              </p>
            </div>

            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(e) => setConsentAccepted(e.target.checked)}
                className="mt-1"
              />
              <span>
                Acepto expresamente los términos y autorizo el tratamiento de datos bajo la versión{' '}
                <strong className="font-mono">{CONSENT_VERSION}</strong>.
              </span>
            </label>
          </div>
        )}

        {/* Footer Controls */}
        <div className="pt-4 border-t border-slate-200/80 dark:border-[#00B8FF]/15 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as typeof step)}
                className="axy-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Anterior
              </button>
            )}
            <button
              type="button"
              disabled={submitting}
              onClick={() => handlePersist('DRAFT')}
              className="axy-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              Guardar Borrador
            </button>
          </div>

          <div className="flex items-center gap-2">
            {step < 5 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s + 1) as typeof step)}
                className="axy-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs cursor-pointer"
              >
                Siguiente
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => handlePersist('SUBMIT')}
                className="axy-btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-xs cursor-pointer disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" />
                {submitting ? 'Enviando y Ejecutando Motor V2...' : 'Enviar Solicitud y Ejecutar Motor V2'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
