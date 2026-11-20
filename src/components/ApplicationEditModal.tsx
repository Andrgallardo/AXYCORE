import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Cpu,
  DollarSign,
  FileCheck2,
  Plus,
  Save,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  updateReceivedApplicationAndReevaluate,
  type CustomerUpdateInput,
  type ReceivedBusinessEditInput,
} from '../services/axycoreStore';
import type {
  AdditionalIncomeStatus,
  AmortizationMethod,
  ApplicationRecord,
  CurrencyCode,
  DebtDeclarationStatus,
  HousingType,
  IncomeSourceType,
  PaymentFrequency,
  ProductCode,
  ReferenceItem,
  ScoringExecutionRecord,
  SocialMediaStatus,
} from '../types/axycore';
import {
  PRODUCT_LABELS,
  SCORING_STATUS_LABELS,
  formatMoney,
  formatRatePct,
  formatUserFacingError,
} from '../utils/formatters';

type EditTab = 'credito' | 'finanzas' | 'solicitante' | 'referencias';

interface ApplicationEditModalProps {
  application: ApplicationRecord;
  onClose: () => void;
  onSaved?: (result: {
    application: ApplicationRecord;
    newScoring?: ScoringExecutionRecord;
    previousScore: number | null;
    changedFields: string[];
  }) => void;
}

export function ApplicationEditModal({
  application,
  onClose,
  onSaved,
}: ApplicationEditModalProps) {
  const { customers, businesses, activeOrTestPolicy, userProfile } = useAxyCore();

  const customer = useMemo(
    () => customers.find((c) => c.id === application.customerId) ?? null,
    [customers, application.customerId]
  );
  const business = useMemo(
    () => (application.businessId ? businesses.find((b) => b.id === application.businessId) ?? null : null),
    [businesses, application.businessId]
  );

  const [tab, setTab] = useState<EditTab>('credito');
  const [savingMode, setSavingMode] = useState<'SAVE' | 'REEVALUATE' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reevalResult, setReevalResult] = useState<{
    previousScore: number | null;
    newScoring?: ScoringExecutionRecord;
    changedFields: string[];
  } | null>(null);

  // 1. Loan Conditions
  const [productCode, setProductCode] = useState<ProductCode>(application.productCode);
  const [currency, setCurrency] = useState<CurrencyCode>(application.currency);
  const [requestedAmount, setRequestedAmount] = useState<string>(String(application.requestedAmount ?? 0));
  const [requestedTermMonths, setRequestedTermMonths] = useState<string>(String(application.requestedTermMonths ?? 12));
  const [paymentFrequency, setPaymentFrequency] = useState<PaymentFrequency>(application.paymentFrequency);
  const [amortizationMethod, setAmortizationMethod] = useState<AmortizationMethod>(application.amortizationMethod);
  const [loanPurpose, setLoanPurpose] = useState<string>(application.loanPurpose ?? '');
  const [loanPurposeDescription, setLoanPurposeDescription] = useState<string>(application.loanPurposeDescription ?? '');
  const [proposedCollateral, setProposedCollateral] = useState<string>(application.proposedCollateral ?? '');

  // 2. Individual Financial Data
  const fd = application.financialData ?? {
    incomeCurrency: application.currency,
    debtDeclarationStatus: 'UNDECLARED' as DebtDeclarationStatus,
  };
  const [activityType, setActivityType] = useState<string>(fd.activityType ?? '');
  const [employerOrBusinessName, setEmployerOrBusinessName] = useState<string>(fd.employerOrBusinessName ?? '');
  const [occupationOrRole, setOccupationOrRole] = useState<string>(fd.occupationOrRole ?? '');
  const [employmentMonths, setEmploymentMonths] = useState<string>(fd.employmentMonths != null ? String(fd.employmentMonths) : '');
  const [incomeSourceType, setIncomeSourceType] = useState<IncomeSourceType>(fd.incomeSourceType ?? 'FIJA_RECURRENTE');
  const [incomeCurrency, setIncomeCurrency] = useState<CurrencyCode>(fd.incomeCurrency ?? application.currency);
  const [primaryNetIncome, setPrimaryNetIncome] = useState<string>(fd.primaryNetIncome != null ? String(fd.primaryNetIncome) : '');
  const [additionalIncomeStatus, setAdditionalIncomeStatus] = useState<AdditionalIncomeStatus>(fd.additionalIncomeStatus ?? 'EXPLICIT_NONE');
  const [additionalNetIncome, setAdditionalNetIncome] = useState<string>(fd.additionalNetIncome != null ? String(fd.additionalNetIncome) : '');
  const [essentialExpenses, setEssentialExpenses] = useState<string>(fd.essentialExpenses != null ? String(fd.essentialExpenses) : '');
  const [housingPaymentFin, setHousingPaymentFin] = useState<string>(fd.housingPayment != null ? String(fd.housingPayment) : '');
  const [housingIncludedInExpenses, setHousingIncludedInExpenses] = useState<boolean>(Boolean(fd.housingIncludedInExpenses));
  const [debtDeclarationStatus, setDebtDeclarationStatus] = useState<DebtDeclarationStatus>(fd.debtDeclarationStatus ?? 'UNDECLARED');
  const [debtCount, setDebtCount] = useState<string>(fd.debtCount != null ? String(fd.debtCount) : '');
  const [totalDebtBalance, setTotalDebtBalance] = useState<string>(fd.totalDebtBalance != null ? String(fd.totalDebtBalance) : '');
  const [bankDebtPayment, setBankDebtPayment] = useState<string>(fd.bankDebtPayment != null ? String(fd.bankDebtPayment) : '');
  const [financeDebtPayment, setFinanceDebtPayment] = useState<string>(fd.financeDebtPayment != null ? String(fd.financeDebtPayment) : '');
  const [cardDebtPayment, setCardDebtPayment] = useState<string>(fd.cardDebtPayment != null ? String(fd.cardDebtPayment) : '');
  const [informalDebtPayment, setInformalDebtPayment] = useState<string>(fd.informalDebtPayment != null ? String(fd.informalDebtPayment) : '');
  const [otherDebtPayment, setOtherDebtPayment] = useState<string>(fd.otherDebtPayment != null ? String(fd.otherDebtPayment) : '');
  const [currentDebtPayments, setCurrentDebtPayments] = useState<string>(fd.currentDebtPayments != null ? String(fd.currentDebtPayments) : '');

  // 2b. Business Financial Data (when applicantType === 'BUSINESS')
  const bfd = application.businessFinancialData;
  const [grossSales, setGrossSales] = useState<string>(bfd?.grossSales != null ? String(bfd.grossSales) : '');
  const [operatingCosts, setOperatingCosts] = useState<string>(bfd?.operatingCosts != null ? String(bfd.operatingCosts) : '');
  const [netMonthlyFlow, setNetMonthlyFlow] = useState<string>(bfd?.netMonthlyFlow != null ? String(bfd.netMonthlyFlow) : '');
  const [businessObligationsMonthly, setBusinessObligationsMonthly] = useState<string>(bfd?.businessObligationsMonthly != null ? String(bfd.businessObligationsMonthly) : '');
  const [totalBusinessDebtBalance, setTotalBusinessDebtBalance] = useState<string>(bfd?.totalBusinessDebtBalance != null ? String(bfd.totalBusinessDebtBalance) : '');
  const [businessDebtCount, setBusinessDebtCount] = useState<string>(bfd?.businessDebtCount != null ? String(bfd.businessDebtCount) : '');
  const [operationsMonths, setOperationsMonths] = useState<string>(bfd?.operationsMonths != null ? String(bfd.operationsMonths) : '');
  const [repaymentSource, setRepaymentSource] = useState<string>(bfd?.repaymentSource ?? '');
  const [businessDebtStatus, setBusinessDebtStatus] = useState<DebtDeclarationStatus>(bfd?.debtDeclarationStatus ?? 'UNDECLARED');

  // 3. Customer & Business Master Data (optional synced edit)
  const [syncCustomer, setSyncCustomer] = useState<boolean>(Boolean(customer));
  const [custFirstName, setCustFirstName] = useState<string>(customer?.firstName ?? '');
  const [custLastName, setCustLastName] = useState<string>(customer?.lastName ?? '');
  const [custPhone, setCustPhone] = useState<string>(customer?.phone ?? '');
  const [custAltPhone, setCustAltPhone] = useState<string>(customer?.altPhone ?? '');
  const [custEmail, setCustEmail] = useState<string>(customer?.email ?? '');
  const [custBirthDate, setCustBirthDate] = useState<string>(customer?.birthDate ?? '');
  const [custMaritalStatus, setCustMaritalStatus] = useState<string>(customer?.maritalStatus ?? '');
  const [custAddress, setCustAddress] = useState<string>(customer?.address ?? '');
  const [custMunicipality, setCustMunicipality] = useState<string>(customer?.municipality ?? '');
  const [custProvince, setCustProvince] = useState<string>(customer?.province ?? '');
  const [custHousingType, setCustHousingType] = useState<HousingType>(customer?.housingType ?? 'NO_DECLARADA');
  const [custResidenceMonths, setCustResidenceMonths] = useState<string>(customer?.residenceMonths != null ? String(customer.residenceMonths) : '');
  const [custHousingPayment, setCustHousingPayment] = useState<string>(customer?.housingPayment != null ? String(customer.housingPayment) : '');
  const [custSocialStatus, setCustSocialStatus] = useState<SocialMediaStatus>(customer?.socialMediaDeclared ?? 'UNANSWERED');
  const [custSocialHandle, setCustSocialHandle] = useState<string>(customer?.socialMediaHandle ?? '');
  const [custAltContactName, setCustAltContactName] = useState<string>(customer?.altContactName ?? '');
  const [custAltContactPhone, setCustAltContactPhone] = useState<string>(customer?.altContactPhone ?? '');

  // Business fields
  const [bizLegalName, setBizLegalName] = useState<string>(business?.legalName ?? '');
  const [bizTradeName, setBizTradeName] = useState<string>(business?.tradeName ?? '');
  const [bizCompanyType, setBizCompanyType] = useState<string>(business?.companyType ?? '');
  const [bizEconomicActivity, setBizEconomicActivity] = useState<string>(business?.economicActivity ?? '');
  const [bizStartDate, setBizStartDate] = useState<string>(business?.operationsStartDate ?? '');
  const [bizRepName, setBizRepName] = useState<string>(business?.authorizedRepName ?? '');
  const [bizRepDoc, setBizRepDoc] = useState<string>(business?.authorizedRepDoc ?? '');

  // 4. References & Declared Documents
  const [references, setReferences] = useState<ReferenceItem[]>(
    application.references?.length ? application.references.map((r) => ({ ...r })) : []
  );
  const [hasIdentityDoc, setHasIdentityDoc] = useState<boolean>(Boolean(application.declaredDocumentsSummary?.hasIdentityDoc));
  const [hasIncomeEvidence, setHasIncomeEvidence] = useState<boolean>(Boolean(application.declaredDocumentsSummary?.hasIncomeEvidence));
  const [hasAddressProof, setHasAddressProof] = useState<boolean>(Boolean(application.declaredDocumentsSummary?.hasAddressProof));
  const [hasCorporateDocs, setHasCorporateDocs] = useState<boolean>(Boolean(application.declaredDocumentsSummary?.hasCorporateDocs));

  // Correction Note
  const [correctionNote, setCorrectionNote] = useState<string>('');

  const toOptNum = (val: string): number | null => {
    const t = val.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const handleSubmit = async (reevaluateWithEngine: boolean) => {
    if (!userProfile) return;
    setErrorMsg(null);
    setReevalResult(null);

    const parsedAmount = Number(requestedAmount);
    const parsedTerm = Number(requestedTermMonths);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg('Ingresa un monto solicitado válido mayor a cero.');
      setTab('credito');
      return;
    }
    if (!Number.isFinite(parsedTerm) || parsedTerm <= 0 || parsedTerm > 360) {
      setErrorMsg('Ingresa un plazo solicitado válido entre 1 y 360 meses.');
      setTab('credito');
      return;
    }

    const pIncome = toOptNum(primaryNetIncome);
    const hasAddIncome = additionalIncomeStatus === 'QUANTIFIED' || additionalIncomeStatus === 'PARTIAL';
    const addIncome = hasAddIncome ? toOptNum(additionalNetIncome) ?? 0 : 0;
    const declaredTotalMonthlyIncome = pIncome !== null ? pIncome + addIncome : fd.declaredTotalMonthlyIncome ?? null;

    const bankPmt = toOptNum(bankDebtPayment) ?? 0;
    const finPmt = toOptNum(financeDebtPayment) ?? 0;
    const cardPmt = toOptNum(cardDebtPayment) ?? 0;
    const infPmt = toOptNum(informalDebtPayment) ?? 0;
    const othPmt = toOptNum(otherDebtPayment) ?? 0;
    const itemizedSum = bankPmt + finPmt + cardPmt + infPmt + othPmt;
    const manualDebtPmt = toOptNum(currentDebtPayments);
    const effectiveDebtPayments =
      debtDeclarationStatus === 'NO_DEBTS_EXPLICIT'
        ? 0
        : manualDebtPmt !== null
        ? manualDebtPmt
        : itemizedSum > 0
        ? itemizedSum
        : null;

    let customerUpdates: CustomerUpdateInput | null = null;
    if (customer && syncCustomer) {
      customerUpdates = {
        firstName: custFirstName,
        lastName: custLastName,
        phone: custPhone,
        altPhone: custAltPhone,
        email: custEmail,
        birthDate: custBirthDate,
        nationality: customer.nationality,
        maritalStatus: custMaritalStatus,
        address: custAddress,
        municipality: custMunicipality,
        province: custProvince,
        residenceMonths: toOptNum(custResidenceMonths) ?? 0,
        housingType: custHousingType,
        housingPayment: toOptNum(custHousingPayment) ?? 0,
        socialMediaDeclared: custSocialStatus,
        socialMediaHandle: custSocialHandle,
        altContactName: custAltContactName,
        altContactPhone: custAltContactPhone,
      };
    }

    let businessUpdates: ReceivedBusinessEditInput | null = null;
    if (business && application.applicantType === 'BUSINESS') {
      businessUpdates = {
        legalName: bizLegalName,
        tradeName: bizTradeName,
        companyType: bizCompanyType,
        economicActivity: bizEconomicActivity,
        operationsStartDate: bizStartDate,
        authorizedRepName: bizRepName,
        authorizedRepDoc: bizRepDoc,
        corporateDocsSummary: business.corporateDocsSummary,
      };
    }

    setSavingMode(reevaluateWithEngine ? 'REEVALUATE' : 'SAVE');
    try {
      const result = await updateReceivedApplicationAndReevaluate({
        application,
        customer,
        business,
        customerUpdates,
        businessUpdates,
        reevaluateWithEngine,
        policy: activeOrTestPolicy,
        user: userProfile,
        correctionNote,
        updates: {
          productCode,
          currency,
          requestedAmount: parsedAmount,
          requestedTermMonths: Math.round(parsedTerm),
          paymentFrequency,
          amortizationMethod,
          loanPurpose,
          loanPurposeDescription,
          proposedCollateral,
          financialData: {
            activityType: activityType.trim() || undefined,
            employerOrBusinessName: employerOrBusinessName.trim() || undefined,
            occupationOrRole: occupationOrRole.trim() || undefined,
            employmentMonths: toOptNum(employmentMonths),
            incomeSourceType,
            primaryNetIncome: pIncome,
            additionalIncomeStatus,
            additionalNetIncome: hasAddIncome ? toOptNum(additionalNetIncome) : 0,
            declaredTotalMonthlyIncome,
            incomeCurrency,
            essentialExpenses: toOptNum(essentialExpenses),
            housingPayment: toOptNum(housingPaymentFin),
            housingIncludedInExpenses,
            debtDeclarationStatus,
            debtCount: debtDeclarationStatus === 'NO_DEBTS_EXPLICIT' ? 0 : toOptNum(debtCount),
            totalDebtBalance: debtDeclarationStatus === 'NO_DEBTS_EXPLICIT' ? 0 : toOptNum(totalDebtBalance),
            currentDebtPayments: effectiveDebtPayments,
            bankDebtPayment: debtDeclarationStatus === 'NO_DEBTS_EXPLICIT' ? 0 : toOptNum(bankDebtPayment),
            financeDebtPayment: debtDeclarationStatus === 'NO_DEBTS_EXPLICIT' ? 0 : toOptNum(financeDebtPayment),
            cardDebtPayment: debtDeclarationStatus === 'NO_DEBTS_EXPLICIT' ? 0 : toOptNum(cardDebtPayment),
            informalDebtPayment: debtDeclarationStatus === 'NO_DEBTS_EXPLICIT' ? 0 : toOptNum(informalDebtPayment),
            otherDebtPayment: debtDeclarationStatus === 'NO_DEBTS_EXPLICIT' ? 0 : toOptNum(otherDebtPayment),
          },
          businessFinancialData:
            application.applicantType === 'BUSINESS'
              ? {
                  grossSales: toOptNum(grossSales),
                  operatingCosts: toOptNum(operatingCosts),
                  netMonthlyFlow:
                    toOptNum(netMonthlyFlow) ??
                    (toOptNum(grossSales) !== null && toOptNum(operatingCosts) !== null
                      ? Math.max(0, (toOptNum(grossSales) ?? 0) - (toOptNum(operatingCosts) ?? 0))
                      : null),
                  businessObligationsMonthly: toOptNum(businessObligationsMonthly),
                  totalBusinessDebtBalance: toOptNum(totalBusinessDebtBalance),
                  businessDebtCount: toOptNum(businessDebtCount),
                  operationsMonths: toOptNum(operationsMonths),
                  repaymentSource: repaymentSource.trim() || undefined,
                  incomeCurrency,
                  debtDeclarationStatus: businessDebtStatus,
                }
              : null,
          references,
          declaredDocumentsSummary: {
            hasIdentityDoc,
            hasIncomeEvidence,
            hasAddressProof,
            hasCorporateDocs,
          },
        },
      });

      setReevalResult({
        previousScore: result.previousScore,
        newScoring: result.newScoring,
        changedFields: result.changedFields,
      });
      if (onSaved) onSaved(result);
    } catch (err) {
      setErrorMsg(formatUserFacingError(err, 'No se pudo actualizar la solicitud.'));
    } finally {
      setSavingMode(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#030816]/65 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="axy-panel-in axy-surface relative w-full max-w-4xl max-h-[92vh] rounded-2xl border border-[var(--axy-border-strong)] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="axy-infinity-line shrink-0" />

        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--axy-border)] flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
              <span>{application.applicationNumber}</span>
              <span>·</span>
              <span>Estado: {application.status}</span>
              <span>·</span>
              <span>Score actual: {application.latestScore != null ? `${application.latestScore}/100` : 'Sin evaluar'}</span>
            </div>
            <h3 className="font-display text-base sm:text-lg font-bold text-slate-950 dark:text-white truncate">
              Actualizar Solicitud Recibida — {application.applicantDisplayName}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Corrige datos mal llenados por el cliente y reevalúa inmediatamente con el Motor de Decisiones Crediticias V2.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="axy-btn-secondary p-1.5 text-slate-500 cursor-pointer shrink-0"
            aria-label="Cerrar editor de solicitud"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Subtabs */}
        <div className="px-5 pt-2.5 border-b border-[var(--axy-border)] flex items-center gap-1 overflow-x-auto shrink-0">
          {[
            { id: 'credito' as const, label: '1. Condiciones del Crédito', icon: DollarSign },
            { id: 'finanzas' as const, label: '2. Ingresos, Gastos y Deudas', icon: Building2 },
            { id: 'solicitante' as const, label: '3. Datos del Cliente', icon: User },
            { id: 'referencias' as const, label: '4. Referencias y Documentos', icon: FileCheck2 },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 whitespace-nowrap cursor-pointer transition-colors ${
                  active
                    ? 'border-[#0066FF] text-[#0066FF] dark:border-[#00D1FF] dark:text-[#00D1FF]'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Scrollable Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {reevalResult && (
            <div className="p-4 rounded-xl border border-emerald-300 bg-emerald-50/90 dark:border-emerald-800 dark:bg-emerald-950/35 text-emerald-950 dark:text-emerald-100 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    {reevalResult.newScoring
                      ? 'Solicitud actualizada y reevaluada exitosamente con Motor V2'
                      : 'Cambios de la solicitud guardados correctamente'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                >
                  Listo, cerrar
                </button>
              </div>
              {reevalResult.newScoring && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  <div className="p-2.5 rounded-lg bg-white/80 dark:bg-slate-900/60">
                    <div className="text-[10px] text-slate-500">Nuevo Score V2</div>
                    <div className="font-mono font-bold text-sm">
                      {reevalResult.previousScore !== null ? `${reevalResult.previousScore} → ` : ''}
                      {reevalResult.newScoring.totalScore}/100
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white/80 dark:bg-slate-900/60">
                    <div className="text-[10px] text-slate-500">Precalificación</div>
                    <div className="font-bold text-sm">
                      {SCORING_STATUS_LABELS[reevalResult.newScoring.status]}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white/80 dark:bg-slate-900/60">
                    <div className="text-[10px] text-slate-500">Monto Recomendado</div>
                    <div className="font-mono font-bold text-sm">
                      {formatMoney(reevalResult.newScoring.recommendedAmount, currency)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white/80 dark:bg-slate-900/60">
                    <div className="text-[10px] text-slate-500">Tasa / Cuota</div>
                    <div className="font-mono font-bold text-sm">
                      {formatRatePct(reevalResult.newScoring.recommendedRateMonthly)} ·{' '}
                      {formatMoney(reevalResult.newScoring.recommendedInstallment, currency)}
                    </div>
                  </div>
                </div>
              )}
              <p className="text-[11px] opacity-85">
                Campos actualizados: {reevalResult.changedFields.length > 0 ? reevalResult.changedFields.join(', ') : 'Confirmación de datos'}.
              </p>
            </div>
          )}

          {/* TAB 1: CONDICIONES DEL CRÉDITO */}
          {tab === 'credito' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Producto Crediticio</label>
                <select
                  value={productCode}
                  onChange={(e) => setProductCode(e.target.value as ProductCode)}
                  className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                >
                  {(Object.entries(PRODUCT_LABELS) as Array<[ProductCode, string]>).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Moneda</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                  className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                >
                  <option value="DOP">DOP (Pesos Dominicanos)</option>
                  <option value="USD">USD (Dólares)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Monto Solicitado ({currency}) *</label>
                <input
                  type="number"
                  min={1}
                  step="any"
                  value={requestedAmount}
                  onChange={(e) => setRequestedAmount(e.target.value)}
                  className="axy-input w-full px-3 py-2 font-mono font-semibold text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Plazo Solicitado (Meses) *</label>
                <input
                  type="number"
                  min={1}
                  max={360}
                  value={requestedTermMonths}
                  onChange={(e) => setRequestedTermMonths(e.target.value)}
                  className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Frecuencia de Pago</label>
                <select
                  value={paymentFrequency}
                  onChange={(e) => setPaymentFrequency(e.target.value as PaymentFrequency)}
                  className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                >
                  <option value="SEMANAL">Semanal</option>
                  <option value="QUINCENAL">Quincenal</option>
                  <option value="MENSUAL">Mensual</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Método de Amortización</label>
                <select
                  value={amortizationMethod}
                  onChange={(e) => setAmortizationMethod(e.target.value as AmortizationMethod)}
                  className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                >
                  <option value="FRANCES">Francés (Cuota Fija)</option>
                  <option value="ALEMAN">Alemán (Capital Fijo)</option>
                  <option value="FLAT">Flat / Tasa Fija</option>
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Destino del Préstamo</label>
                <input
                  value={loanPurpose}
                  onChange={(e) => setLoanPurpose(e.target.value)}
                  placeholder="Ej. Capital de trabajo, consolidación de deudas, remodelación..."
                  className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Detalle del Destino</label>
                <textarea
                  rows={2}
                  value={loanPurposeDescription}
                  onChange={(e) => setLoanPurposeDescription(e.target.value)}
                  className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Garantía Propuesta</label>
                <input
                  value={proposedCollateral}
                  onChange={(e) => setProposedCollateral(e.target.value)}
                  placeholder="Ej. Vehículo, inmueble, garante solidario, sin garantía..."
                  className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          {/* TAB 2: DATOS FINANCIEROS */}
          {tab === 'finanzas' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Fuente Principal de Ingreso</label>
                  <select
                    value={incomeSourceType}
                    onChange={(e) => setIncomeSourceType(e.target.value as IncomeSourceType)}
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                  >
                    <option value="FIJA_RECURRENTE">Fija Recurrente (Salario Formal)</option>
                    <option value="MIXTA_RECURRENTE">Mixta Recurrente</option>
                    <option value="IRREGULAR">Irregular / Independiente</option>
                    <option value="SIN_INGRESOS">Sin Ingresos Declarados</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Moneda de Ingresos</label>
                  <select
                    value={incomeCurrency}
                    onChange={(e) => setIncomeCurrency(e.target.value as CurrencyCode)}
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                  >
                    <option value="DOP">DOP</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Antigüedad Laboral / Negocio (Meses)</label>
                  <input
                    type="number"
                    min={0}
                    value={employmentMonths}
                    onChange={(e) => setEmploymentMonths(e.target.value)}
                    className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Empleador o Negocio</label>
                  <input
                    value={employerOrBusinessName}
                    onChange={(e) => setEmployerOrBusinessName(e.target.value)}
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Cargo u Ocupación</label>
                  <input
                    value={occupationOrRole}
                    onChange={(e) => setOccupationOrRole(e.target.value)}
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Actividad Económica</label>
                  <input
                    value={activityType}
                    onChange={(e) => setActivityType(e.target.value)}
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Ingreso Principal Neto Mensual ({incomeCurrency})</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={primaryNetIncome}
                    onChange={(e) => setPrimaryNetIncome(e.target.value)}
                    className="axy-input w-full px-3 py-2 font-mono font-semibold text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Ingresos Adicionales</label>
                  <select
                    value={additionalIncomeStatus}
                    onChange={(e) => setAdditionalIncomeStatus(e.target.value as AdditionalIncomeStatus)}
                    className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                  >
                    <option value="EXPLICIT_NONE">No tiene ingresos adicionales</option>
                    <option value="QUANTIFIED">Sí tiene (Cuantificados)</option>
                    <option value="PARTIAL">Parcialmente declarados</option>
                    <option value="INCONSISTENT">Inconsistente / Por verificar</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Monto Ingreso Adicional ({incomeCurrency})</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    disabled={additionalIncomeStatus !== 'QUANTIFIED' && additionalIncomeStatus !== 'PARTIAL'}
                    value={additionalNetIncome}
                    onChange={(e) => setAdditionalNetIncome(e.target.value)}
                    className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Gastos Esenciales Mensuales ({incomeCurrency})</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={essentialExpenses}
                    onChange={(e) => setEssentialExpenses(e.target.value)}
                    className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Pago Vivienda / Alquiler ({incomeCurrency})</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={housingPaymentFin}
                    onChange={(e) => setHousingPaymentFin(e.target.value)}
                    className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white"
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={housingIncludedInExpenses}
                      onChange={(e) => setHousingIncludedInExpenses(e.target.checked)}
                    />
                    <span>Vivienda ya incluida en gastos esenciales</span>
                  </label>
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--axy-border)] space-y-3">
                <h4 className="font-bold text-slate-900 dark:text-white">Declaración de Deudas Actuales</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Estado de Deudas</label>
                    <select
                      value={debtDeclarationStatus}
                      onChange={(e) => setDebtDeclarationStatus(e.target.value as DebtDeclarationStatus)}
                      className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
                    >
                      <option value="NO_DEBTS_EXPLICIT">Sin deudas actuales</option>
                      <option value="HAS_DEBTS">Con deudas declaradas</option>
                      <option value="UNDECLARED">No declarado</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Cantidad de Deudas</label>
                    <input
                      type="number"
                      min={0}
                      disabled={debtDeclarationStatus === 'NO_DEBTS_EXPLICIT'}
                      value={debtCount}
                      onChange={(e) => setDebtCount(e.target.value)}
                      className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Saldo Total Deudas</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      disabled={debtDeclarationStatus === 'NO_DEBTS_EXPLICIT'}
                      value={totalDebtBalance}
                      onChange={(e) => setTotalDebtBalance(e.target.value)}
                      className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Cuota Mensual Total Deudas</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      disabled={debtDeclarationStatus === 'NO_DEBTS_EXPLICIT'}
                      value={currentDebtPayments}
                      onChange={(e) => setCurrentDebtPayments(e.target.value)}
                      placeholder="Auto-suma si vacío"
                      className="axy-input w-full px-3 py-2 font-mono font-semibold text-slate-900 dark:text-white disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Cuota Bancos</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      disabled={debtDeclarationStatus === 'NO_DEBTS_EXPLICIT'}
                      value={bankDebtPayment}
                      onChange={(e) => setBankDebtPayment(e.target.value)}
                      className="axy-input w-full px-3 py-1.5 font-mono text-slate-900 dark:text-white disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Cuota Financieras</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      disabled={debtDeclarationStatus === 'NO_DEBTS_EXPLICIT'}
                      value={financeDebtPayment}
                      onChange={(e) => setFinanceDebtPayment(e.target.value)}
                      className="axy-input w-full px-3 py-1.5 font-mono text-slate-900 dark:text-white disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Cuota Tarjetas</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      disabled={debtDeclarationStatus === 'NO_DEBTS_EXPLICIT'}
                      value={cardDebtPayment}
                      onChange={(e) => setCardDebtPayment(e.target.value)}
                      className="axy-input w-full px-3 py-1.5 font-mono text-slate-900 dark:text-white disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Informales / Otras</label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        disabled={debtDeclarationStatus === 'NO_DEBTS_EXPLICIT'}
                        value={informalDebtPayment}
                        onChange={(e) => setInformalDebtPayment(e.target.value)}
                        placeholder="Inf."
                        className="axy-input w-1/2 px-2 py-1.5 font-mono text-slate-900 dark:text-white disabled:opacity-50"
                      />
                      <input
                        type="number"
                        min={0}
                        step="any"
                        disabled={debtDeclarationStatus === 'NO_DEBTS_EXPLICIT'}
                        value={otherDebtPayment}
                        onChange={(e) => setOtherDebtPayment(e.target.value)}
                        placeholder="Otras"
                        className="axy-input w-1/2 px-2 py-1.5 font-mono text-slate-900 dark:text-white disabled:opacity-50"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {application.applicantType === 'BUSINESS' && (
                <div className="pt-3 border-t border-[var(--axy-border)] space-y-3">
                  <h4 className="font-bold text-slate-900 dark:text-white">Datos Financieros de la Empresa</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Ventas Brutas Mensuales</label>
                      <input type="number" min={0} step="any" value={grossSales} onChange={(e) => setGrossSales(e.target.value)} className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Costos Operativos Mensuales</label>
                      <input type="number" min={0} step="any" value={operatingCosts} onChange={(e) => setOperatingCosts(e.target.value)} className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Flujo Neto Mensual</label>
                      <input type="number" min={0} step="any" value={netMonthlyFlow} onChange={(e) => setNetMonthlyFlow(e.target.value)} className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Obligaciones Mensuales Empresa</label>
                      <input type="number" min={0} step="any" value={businessObligationsMonthly} onChange={(e) => setBusinessObligationsMonthly(e.target.value)} className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Saldo Deuda Empresarial</label>
                      <input type="number" min={0} step="any" value={totalBusinessDebtBalance} onChange={(e) => setTotalBusinessDebtBalance(e.target.value)} className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Meses de Operación</label>
                      <input type="number" min={0} value={operationsMonths} onChange={(e) => setOperationsMonths(e.target.value)} className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Cantidad Deudas Empresa</label>
                      <input type="number" min={0} value={businessDebtCount} onChange={(e) => setBusinessDebtCount(e.target.value)} className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Estado Deudas Empresa</label>
                      <select value={businessDebtStatus} onChange={(e) => setBusinessDebtStatus(e.target.value as DebtDeclarationStatus)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white">
                        <option value="NO_DEBTS_EXPLICIT">Sin deudas</option>
                        <option value="HAS_DEBTS">Con deudas declaradas</option>
                        <option value="UNDECLARED">No declarado</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Fuente de Repago</label>
                      <input value={repaymentSource} onChange={(e) => setRepaymentSource(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: DATOS DEL CLIENTE / EMPRESA */}
          {tab === 'solicitante' && (
            <div className="space-y-4">
              {!customer ? (
                <div className="p-4 rounded-xl axy-surface-tonal text-slate-500">
                  No se encontró expediente maestro de cliente vinculado a esta solicitud.
                </div>
              ) : (
                <>
                  <label className="inline-flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                    <input type="checkbox" checked={syncCustomer} onChange={(e) => setSyncCustomer(e.target.checked)} />
                    <span>Actualizar también el perfil maestro del cliente ({customer.documentType} {customer.documentNumber})</span>
                  </label>
                  <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 ${!syncCustomer ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Nombres *</label>
                      <input value={custFirstName} onChange={(e) => setCustFirstName(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Apellidos *</label>
                      <input value={custLastName} onChange={(e) => setCustLastName(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Teléfono Principal *</label>
                      <input value={custPhone} onChange={(e) => setCustPhone(e.target.value)} className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Teléfono Alterno</label>
                      <input value={custAltPhone} onChange={(e) => setCustAltPhone(e.target.value)} className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Correo Electrónico</label>
                      <input type="email" value={custEmail} onChange={(e) => setCustEmail(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Fecha de Nacimiento</label>
                      <input type="date" value={custBirthDate} onChange={(e) => setCustBirthDate(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Estado Civil</label>
                      <input value={custMaritalStatus} onChange={(e) => setCustMaritalStatus(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Tipo de Vivienda</label>
                      <select value={custHousingType} onChange={(e) => setCustHousingType(e.target.value as HousingType)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white">
                        <option value="PROPIA">Propia</option>
                        <option value="ALQUILADA">Alquilada</option>
                        <option value="FAMILIAR">Familiar</option>
                        <option value="OTRA">Otra</option>
                        <option value="NO_DECLARADA">No declarada</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Meses de Residencia</label>
                      <input type="number" min={0} value={custResidenceMonths} onChange={(e) => setCustResidenceMonths(e.target.value)} className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Dirección Residencial</label>
                      <input value={custAddress} onChange={(e) => setCustAddress(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Pago Vivienda (Perfil)</label>
                      <input type="number" min={0} value={custHousingPayment} onChange={(e) => setCustHousingPayment(e.target.value)} className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Municipio</label>
                      <input value={custMunicipality} onChange={(e) => setCustMunicipality(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Provincia</label>
                      <input value={custProvince} onChange={(e) => setCustProvince(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Redes Sociales</label>
                      <select value={custSocialStatus} onChange={(e) => setCustSocialStatus(e.target.value as SocialMediaStatus)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white">
                        <option value="YES">Declara red social</option>
                        <option value="NO_MEDIA">No utiliza redes</option>
                        <option value="UNANSWERED">No respondido</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Usuario Red Social</label>
                      <input value={custSocialHandle} onChange={(e) => setCustSocialHandle(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Contacto Alterno</label>
                      <input value={custAltContactName} onChange={(e) => setCustAltContactName(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Tel. Contacto Alterno</label>
                      <input value={custAltContactPhone} onChange={(e) => setCustAltContactPhone(e.target.value)} className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white" />
                    </div>
                  </div>
                </>
              )}

              {business && application.applicantType === 'BUSINESS' && (
                <div className="pt-4 border-t border-[var(--axy-border)] space-y-3">
                  <h4 className="font-bold text-slate-900 dark:text-white">Datos de la Empresa ({business.rnc})</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Razón Social *</label>
                      <input value={bizLegalName} onChange={(e) => setBizLegalName(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Nombre Comercial</label>
                      <input value={bizTradeName} onChange={(e) => setBizTradeName(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Tipo Societario</label>
                      <input value={bizCompanyType} onChange={(e) => setBizCompanyType(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Actividad Económica</label>
                      <input value={bizEconomicActivity} onChange={(e) => setBizEconomicActivity(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Inicio Operaciones</label>
                      <input type="date" value={bizStartDate} onChange={(e) => setBizStartDate(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Representante Autorizado *</label>
                      <input value={bizRepName} onChange={(e) => setBizRepName(e.target.value)} className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white" />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Doc. Representante</label>
                      <input value={bizRepDoc} onChange={(e) => setBizRepDoc(e.target.value)} className="axy-input w-full px-3 py-2 font-mono text-slate-900 dark:text-white" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: REFERENCIAS Y DOCUMENTOS DECLARADOS */}
          {tab === 'referencias' && (
            <div className="space-y-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 dark:text-white">Referencias Personales / Comerciales</h4>
                  <button
                    type="button"
                    onClick={() => setReferences((prev) => [...prev, { name: '', relationship: '', phone: '' }])}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg axy-btn-secondary font-semibold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Agregar Referencia</span>
                  </button>
                </div>
                {references.length === 0 ? (
                  <p className="text-slate-500">Sin referencias registradas. Agrega al menos 2 referencias válidas.</p>
                ) : (
                  <div className="space-y-2">
                    {references.map((ref, idx) => (
                      <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center p-2.5 rounded-xl axy-surface-tonal">
                        <input
                          placeholder="Nombre completo"
                          value={ref.name}
                          onChange={(e) =>
                            setReferences((prev) => prev.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))
                          }
                          className="sm:col-span-5 axy-input px-2.5 py-1.5 text-slate-900 dark:text-white"
                        />
                        <input
                          placeholder="Relación / Parentesco"
                          value={ref.relationship}
                          onChange={(e) =>
                            setReferences((prev) => prev.map((r, i) => (i === idx ? { ...r, relationship: e.target.value } : r)))
                          }
                          className="sm:col-span-3 axy-input px-2.5 py-1.5 text-slate-900 dark:text-white"
                        />
                        <input
                          placeholder="Teléfono"
                          value={ref.phone}
                          onChange={(e) =>
                            setReferences((prev) => prev.map((r, i) => (i === idx ? { ...r, phone: e.target.value } : r)))
                          }
                          className="sm:col-span-3 axy-input px-2.5 py-1.5 font-mono text-slate-900 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() => setReferences((prev) => prev.filter((_, i) => i !== idx))}
                          className="sm:col-span-1 p-1.5 text-rose-500 hover:bg-rose-500/10 rounded-lg justify-self-end cursor-pointer"
                          title="Eliminar referencia"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-[var(--axy-border)] space-y-2.5">
                <h4 className="font-bold text-slate-900 dark:text-white">Documentos Declarados en Solicitud</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={hasIdentityDoc} onChange={(e) => setHasIdentityDoc(e.target.checked)} />
                    <span>Documento de identidad (Cédula / Pasaporte)</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={hasIncomeEvidence} onChange={(e) => setHasIncomeEvidence(e.target.checked)} />
                    <span>Evidencia / comprobante de ingresos</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={hasAddressProof} onChange={(e) => setHasAddressProof(e.target.checked)} />
                    <span>Comprobante de domicilio</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={hasCorporateDocs} onChange={(e) => setHasCorporateDocs(e.target.checked)} />
                    <span>Documentación societaria / RNC (Empresas)</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Audit Correction Note */}
          <div className="pt-3 border-t border-[var(--axy-border)]">
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Motivo / Observación de la Corrección (se registra en bitácora del expediente)
            </label>
            <input
              value={correctionNote}
              onChange={(e) => setCorrectionNote(e.target.value)}
              placeholder="Ej. Cliente ingresó salario anual en lugar de mensual; se corrigió ingreso neto y deudas actuales."
              className="axy-input w-full px-3 py-2 text-slate-900 dark:text-white"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-[var(--axy-border)] bg-[var(--axy-surface-tonal)] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            disabled={savingMode !== null}
            onClick={onClose}
            className="axy-btn-secondary px-3.5 py-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            Cerrar
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={savingMode !== null || !userProfile}
              onClick={() => handleSubmit(false)}
              className="axy-btn-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingMode === 'SAVE' ? 'Guardando...' : 'Solo Guardar Cambios'}</span>
            </button>
            <button
              type="button"
              disabled={savingMode !== null || !userProfile}
              onClick={() => handleSubmit(true)}
              className="axy-brand-gradient inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-semibold cursor-pointer disabled:opacity-50 shadow-sm"
            >
              <Cpu className={`w-3.5 h-3.5 ${savingMode === 'REEVALUATE' ? 'animate-spin' : ''}`} />
              <span>
                {savingMode === 'REEVALUATE'
                  ? 'Guardando y Reevaluando Motor V2...'
                  : 'Guardar y Reevaluar con Motor V2'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
