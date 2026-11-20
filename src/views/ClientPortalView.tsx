import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  BellOff,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Eye,
  FilePlus2,
  FileText,
  Landmark,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { PaymentEvidencePreviewModal } from '../components/PaymentEvidencePreviewModal';
import {
  DEFAULT_ORG_ID,
  fetchInstallmentsByLoan,
  generateId,
  runBackendAmortization,
  saveCustomerUnique,
  submitOrSaveApplication,
} from '../services/axycoreStore';
import {
  attachPaymentEvidence,
  reportPaymentPendingVerification,
} from '../services/collectionsStore';
import {
  formatEvidenceFileSize,
  getPaymentValidationStatusLabel,
  isPaymentPendingValidation,
  processPaymentEvidenceFile,
  type EncodedPaymentEvidence,
} from '../utils/paymentEvidence';
import {
  APPLICATION_STATUS_LABELS,
  formatMoney,
  formatRatePct,
  formatUserFacingError,
} from '../utils/formatters';

function formatShortDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('es-DO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
import type {
  ApplicationRecord,
  CustomerRecord,
  LoanInstallmentRecord,
  LoanRecord,
  PaymentFrequency,
  ProductCode,
} from '../types/axycore';
import type { PaymentChannelMethod, PaymentRecord } from '../types/collections';

type ClientPortalTab =
  | 'MIS_PRESTAMOS'
  | 'REGISTRAR_PAGO'
  | 'SOLICITAR_RENOVACION'
  | 'MIS_SOLICITUDES';

const PAYMENT_METHODS: Array<{ value: PaymentChannelMethod; label: string }> = [
  { value: 'TRANSFERENCIA', label: 'Transferencia Bancaria' },
  { value: 'DEPOSITO', label: 'Depósito en Ventanilla' },
  { value: 'TARJETA', label: 'Tarjeta de Débito / Crédito' },
  { value: 'LINK_PAGO', label: 'Botón / Link de Pago' },
  { value: 'CAJA_EFECTIVO', label: 'Pago en Caja / Sucursal' },
  { value: 'CHEQUE', label: 'Cheque' },
];

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  REPORTADO: 'Reportado',
  RECIBIDO_PENDIENTE_VERIFICACION: 'Pendiente de verificación',
  VERIFICADO: 'Verificado',
  APLICADO: 'Aplicado a cuota',
  RECHAZADO: 'Rechazado',
  REVERTIDO: 'Revertido',
};

const INSTALLMENT_STATUS_META: Record<
  LoanInstallmentRecord['status'],
  { label: string; colorClass: string }
> = {
  PAGADA: {
    label: 'Pagada',
    colorClass: 'text-emerald-600 dark:text-emerald-400',
  },
  PARCIAL: {
    label: 'Pago parcial',
    colorClass: 'text-sky-600 dark:text-[#00D1FF]',
  },
  VENCIDA: {
    label: 'Vencida',
    colorClass: 'text-rose-600 dark:text-rose-400',
  },
  PENDIENTE: {
    label: 'Pendiente',
    colorClass: 'text-amber-600 dark:text-[#E2B35E]',
  },
};

export function ClientPortalView() {
  const {
    userProfile,
    organization,
    loans,
    payments,
    applications,
    customers,
    activeOrTestPolicy,
    setActiveSection,
    fcmStatus,
    fcmError,
    enableFcmPush,
    disableFcmPush,
    sendTestPush,
  } = useAxyCore();
  const [testingClientPush, setTestingClientPush] = useState(false);

  const [activeTab, setActiveTab] = useState<ClientPortalTab>('MIS_PRESTAMOS');
  const [selectedLoanId, setSelectedLoanId] = useState<string>('');
  const [installments, setInstallments] = useState<LoanInstallmentRecord[]>([]);
  const [loadingInstallments, setLoadingInstallments] = useState(false);

  // Payment Registration state
  const [payLoanId, setPayLoanId] = useState<string>('');
  const [payAmount, setPayAmount] = useState<string>('');
  const [payDate, setPayDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState<PaymentChannelMethod>('TRANSFERENCIA');
  const [payBankName, setPayBankName] = useState<string>('Banco Popular Dominicano');
  const [payReference, setPayReference] = useState<string>('');
  const [payEvidenceFile, setPayEvidenceFile] = useState<EncodedPaymentEvidence | null>(null);
  const [payEvidenceError, setPayEvidenceError] = useState<string | null>(null);
  const [uploadingPaymentId, setUploadingPaymentId] = useState<string | null>(null);
  const [previewPayment, setPreviewPayment] = useState<PaymentRecord | null>(null);
  const [payNotes, setPayNotes] = useState<string>('');
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [paySuccess, setPaySuccess] = useState<string | null>(null);

  // Loan Renewal state
  const [renewalBaseLoanId, setRenewalBaseLoanId] = useState<string>('');
  const [renewalProductCode, setRenewalProductCode] = useState<ProductCode>('PERSONAL_DOP');
  const [renewalAmount, setRenewalAmount] = useState<string>('75000');
  const [renewalTermMonths, setRenewalTermMonths] = useState<string>('12');
  const [renewalFrequency, setRenewalFrequency] = useState<PaymentFrequency>('MENSUAL');
  const [renewalMonthlyIncome, setRenewalMonthlyIncome] = useState<string>('65000');
  const [renewalEssentialExpenses, setRenewalEssentialExpenses] = useState<string>('24000');
  const [renewalPurposeNotes, setRenewalPurposeNotes] = useState<string>(
    'Renovación de préstamo vigente para capital operativo y consolidación.'
  );
  const [renewalDocNumber, setRenewalDocNumber] = useState<string>('');
  const [renewalPhone, setRenewalPhone] = useState<string>('');
  const [renewalAddress, setRenewalAddress] = useState<string>('Santo Domingo, Rep. Dom.');
  const [renewalConsent, setRenewalConsent] = useState<boolean>(false);
  const [renewalSubmitting, setRenewalSubmitting] = useState(false);
  const [renewalError, setRenewalError] = useState<string | null>(null);
  const [renewalResult, setRenewalResult] = useState<{
    applicationNumber: string;
    score: number;
    prequalificationStatus: string;
    recommendedAmount: number;
    recommendedInstallment: number;
    currency: 'DOP' | 'USD';
  } | null>(null);

  const clientLoans = useMemo(() => {
    if (!userProfile) return [];
    // If staff previews client portal, show org loans; if EXTERNAL_CLIENT, listener already scopes createdBy == uid
    return loans;
  }, [loans, userProfile]);

  const activeLoans = useMemo(
    () => clientLoans.filter((l) => l.status === 'ACTIVO' || l.status === 'VENCIDO'),
    [clientLoans]
  );

  const selectedLoan = useMemo<LoanRecord | null>(() => {
    if (clientLoans.length === 0) return null;
    return clientLoans.find((l) => l.id === selectedLoanId) || activeLoans[0] || clientLoans[0];
  }, [clientLoans, activeLoans, selectedLoanId]);

  useEffect(() => {
    if (selectedLoan && !selectedLoanId) {
      setSelectedLoanId(selectedLoan.id);
    }
    if (selectedLoan && !payLoanId) {
      setPayLoanId(selectedLoan.id);
    }
    if (selectedLoan && !renewalBaseLoanId) {
      setRenewalBaseLoanId(selectedLoan.id);
    }
  }, [selectedLoan, selectedLoanId, payLoanId, renewalBaseLoanId]);

  useEffect(() => {
    if (!selectedLoan) {
      setInstallments([]);
      return;
    }

    let cancelled = false;
    setLoadingInstallments(true);

    fetchInstallmentsByLoan(selectedLoan.id, selectedLoan.organizationId)
      .then(async (rows) => {
        if (cancelled) return;
        if (rows.length > 0) {
          setInstallments(rows);
          return;
        }
        // Fallback: generate deterministic schedule preview when installments haven't been persisted
        const sim = await runBackendAmortization({
          financedPrincipal: selectedLoan.totalFinancedPrincipal || selectedLoan.approvedPrincipal,
          monthlyRate: selectedLoan.contractualRateMonthly,
          termMonths: selectedLoan.termMonths,
          frequency: selectedLoan.frequency,
          amortizationMethod: selectedLoan.amortizationMethod,
          disbursementDate: selectedLoan.disbursementDate,
          firstPaymentDate: selectedLoan.firstPaymentDate,
        }).catch(() => null);

        if (cancelled || !sim?.rows) return;
        const mapped: LoanInstallmentRecord[] = (sim.rows as Array<Record<string, unknown>>).map(
          (row, idx) => ({
            id: `sim_${selectedLoan.id}_${idx + 1}`,
            organizationId: selectedLoan.organizationId,
            loanId: selectedLoan.id,
            installmentNumber: Number(row.installmentNumber ?? idx + 1),
            dueDate: String(row.dueDate ?? selectedLoan.firstPaymentDate),
            principalAmount: Number(row.principalAmount ?? 0),
            interestAmount: Number(row.interestAmount ?? 0),
            otherCharges: Number(row.otherCharges ?? 0),
            totalAmount: Number(row.totalAmount ?? 0),
            remainingPrincipalBalance: Number(row.remainingPrincipalBalance ?? 0),
            status: 'PENDIENTE',
          })
        );
        setInstallments(mapped);
      })
      .catch(() => {
        if (!cancelled) setInstallments([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingInstallments(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedLoan]);

  const totalPendingPrincipalDop = useMemo(
    () =>
      activeLoans
        .filter((l) => l.currency === 'DOP')
        .reduce((acc, l) => acc + (l.currentPrincipalBalance || 0), 0),
    [activeLoans]
  );

  const nextDueInstallment = useMemo(() => {
    const unpaid = installments.filter((i) => i.status !== 'PAGADA');
    return unpaid[0] || null;
  }, [installments]);

  const clientPayments = useMemo(() => {
    const loanIds = new Set(clientLoans.map((l) => l.id));
    return payments.filter(
      (p) => loanIds.has(p.loanId) || (userProfile && p.reportedByUserId === userProfile.uid)
    );
  }, [payments, clientLoans, userProfile]);

  const existingClientCustomer = useMemo<CustomerRecord | null>(() => {
    if (!userProfile) return null;
    if (selectedLoan) {
      const matched = customers.find((c) => c.id === selectedLoan.customerId);
      if (matched) return matched;
    }
    return (
      customers.find(
        (c) =>
          c.createdBy === userProfile.uid ||
          (c.email && c.email.toLowerCase() === userProfile.email.toLowerCase())
      ) ||
      customers[0] ||
      null
    );
  }, [customers, selectedLoan, userProfile]);

  const openPaymentForLoan = (loan: LoanRecord) => {
    setPayLoanId(loan.id);
    setSelectedLoanId(loan.id);
    if (nextDueInstallment && nextDueInstallment.loanId === loan.id) {
      setPayAmount(String(nextDueInstallment.totalAmount));
    } else if (!payAmount) {
      const approxCuota =
        loan.termMonths > 0
          ? Math.round((loan.totalFinancedPrincipal / loan.termMonths) * (1 + loan.contractualRateMonthly))
          : 0;
      setPayAmount(approxCuota > 0 ? String(approxCuota) : '');
    }
    setPayError(null);
    setPaySuccess(null);
    setActiveTab('REGISTRAR_PAGO');
  };

  const openRenewalForLoan = (loan: LoanRecord) => {
    setRenewalBaseLoanId(loan.id);
    setRenewalProductCode(loan.productCode);
    setRenewalAmount(String(loan.approvedPrincipal || 75000));
    setRenewalTermMonths(String(loan.termMonths || 12));
    setRenewalFrequency(loan.frequency || 'MENSUAL');
    setRenewalError(null);
    setRenewalResult(null);
    setActiveTab('SOLICITAR_RENOVACION');
  };

  const handlePayEvidenceSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setPayEvidenceError(null);
    if (!file) return;
    try {
      const encoded = await processPaymentEvidenceFile(file);
      setPayEvidenceFile(encoded);
    } catch (err) {
      setPayEvidenceError(
        err instanceof Error ? err.message : 'No se pudo procesar el comprobante seleccionado.'
      );
    }
  };

  const handleInlineAttachEvidence = async (
    pay: PaymentRecord,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !userProfile) return;
    setUploadingPaymentId(pay.id);
    setPayError(null);
    try {
      const encoded = await processPaymentEvidenceFile(file);
      await attachPaymentEvidence({
        payment: pay,
        evidence: encoded,
        user: userProfile,
      });
      setPaySuccess(`Comprobante "${encoded.fileName}" adjuntado correctamente al pago.`);
    } catch (err) {
      setPayError(formatUserFacingError(err, 'No se pudo subir el comprobante.'));
    } finally {
      setUploadingPaymentId(null);
    }
  };

  const handleRegisterPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    setPayError(null);
    setPaySuccess(null);

    const targetLoan = clientLoans.find((l) => l.id === payLoanId) || selectedLoan;
    if (!targetLoan) {
      setPayError('Selecciona el préstamo al cual corresponde el pago.');
      return;
    }
    const numericAmount = Number(payAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setPayError('Ingresa un monto de pago válido mayor a cero.');
      return;
    }
    if (!payReference.trim()) {
      setPayError('Ingresa el número de referencia o comprobante bancario.');
      return;
    }

    setPaySubmitting(true);
    try {
      const created = await reportPaymentPendingVerification({
        loan: targetLoan,
        amount: numericAmount,
        paymentDate: payDate,
        method: payMethod,
        bankName: payBankName.trim() || undefined,
        referenceNumber: payReference.trim(),
        receiptEvidenceName: payEvidenceFile?.fileName || '',
        receiptEvidenceMimeType: payEvidenceFile?.mimeType,
        receiptEvidenceSizeBytes: payEvidenceFile?.sizeBytes,
        receiptEvidenceDataUrl: payEvidenceFile?.dataUrl,
        notes: payNotes.trim() || 'Pago reportado desde Portal de Clientes AxyCore',
        user: userProfile,
      });
      setPaySuccess(
        `Pago reportado correctamente (${formatMoney(created.amount, created.currency)} · Ref. ${
          created.referenceNumber
        }). Enviado a Contabilidad para validación; tu balance se actualizará al ser validado.`
      );
      setPayReference('');
      setPayEvidenceFile(null);
      setPayEvidenceError(null);
      setPayNotes('');
    } catch (err) {
      setPayError(
        formatUserFacingError(err, 'No se pudo registrar el reporte de pago.')
      );
    } finally {
      setPaySubmitting(false);
    }
  };

  const handleSubmitRenewal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    setRenewalError(null);
    setRenewalResult(null);

    if (!renewalConsent) {
      setRenewalError('Debes aceptar la autorización de tratamiento de datos (Ley 172-13) para continuar.');
      return;
    }

    const amountNum = Number(renewalAmount);
    const termNum = Number(renewalTermMonths);
    const incomeNum = Number(renewalMonthlyIncome);
    const expensesNum = Number(renewalEssentialExpenses);

    if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 100_000_000) {
      setRenewalError('El monto solicitado para renovación debe ser mayor que cero y no superar 100,000,000.');
      return;
    }
    if (!Number.isFinite(termNum) || termNum < 1 || termNum > 360) {
      setRenewalError('El plazo solicitado debe estar entre 1 y 360 meses.');
      return;
    }
    if (!Number.isFinite(incomeNum) || incomeNum <= 0) {
      setRenewalError('Declara tus ingresos mensuales netos vigentes.');
      return;
    }

    const effectiveOrgId = userProfile.organizationId || organization.id || DEFAULT_ORG_ID;
    const safeDisplayName = (userProfile.displayName || userProfile.email || 'Cliente')
      .trim()
      .slice(0, 160);

    setRenewalSubmitting(true);
    try {
      let customer = existingClientCustomer;
      if (!customer) {
        const cleanDoc = renewalDocNumber.trim();
        const cleanPhone = renewalPhone.trim();
        if (cleanDoc.length < 5 || cleanPhone.length < 7) {
          throw new Error(
            'Completa tu número de cédula/pasaporte y teléfono de contacto para registrar tu perfil de cliente.'
          );
        }
        const nameParts = safeDisplayName.split(/\s+/);
        const firstName = nameParts[0] || 'Cliente';
        const lastName = nameParts.slice(1).join(' ') || 'AxyCore';

        customer = await saveCustomerUnique({
          organizationId: effectiveOrgId,
          documentType: 'CEDULA',
          documentNumber: cleanDoc,
          firstName,
          lastName,
          phone: cleanPhone,
          email: userProfile.email,
          address: renewalAddress.trim() || 'República Dominicana',
          residenceMonths: 24,
          housingType: 'ALQUILADA',
          housingPayment: 0,
          socialMediaDeclared: 'UNANSWERED',
          createdBy: userProfile.uid,
        });
      }

      const baseLoan = clientLoans.find((l) => l.id === renewalBaseLoanId) || null;
      const derivedCurrency: 'DOP' | 'USD' = renewalProductCode.endsWith('_USD') ? 'USD' : 'DOP';
      const seq = String(Date.now()).slice(-6);
      const appId = generateId('app');
      const appNum = `REN-2026-${seq}`;
      const fileNum = `EXP-2026-${seq}`;

      const renewalApp: ApplicationRecord = {
        id: appId,
        organizationId: effectiveOrgId,
        applicationNumber: appNum,
        fileNumber: fileNum,
        channel: 'EXTERNAL',
        applicantType: renewalProductCode.startsWith('EMPRESARIAL') ? 'BUSINESS' : 'INDIVIDUAL',
        customerId: customer.id,
        businessId: baseLoan?.businessId ?? null,
        applicantDisplayName: `${customer.firstName} ${customer.lastName}`.trim().slice(0, 200),
        productCode: renewalProductCode,
        currency: derivedCurrency,
        requestedAmount: amountNum,
        requestedTermMonths: Math.round(termNum),
        paymentFrequency: renewalFrequency,
        amortizationMethod: 'SALDO_INSOLUTO',
        loanPurpose: (baseLoan
          ? `Renovación de préstamo ${baseLoan.loanNumber}`
          : 'Renovación de línea de crédito personal'
        ).slice(0, 120),
        loanPurposeDescription: renewalPurposeNotes.trim().slice(0, 1000),
        financialData: {
          activityType: 'Empleado / Independiente',
          employerOrBusinessName: 'Declaración actualizada en Portal de Clientes',
          occupationOrRole: 'Titular',
          employmentMonths: 24,
          incomeSourceType: 'FIJA_RECURRENTE',
          primaryNetIncome: incomeNum,
          additionalIncomeStatus: 'EXPLICIT_NONE',
          additionalNetIncome: 0,
          declaredTotalMonthlyIncome: incomeNum,
          incomeCurrency: derivedCurrency,
          essentialExpenses: Number.isFinite(expensesNum) ? expensesNum : 0,
          housingPayment: customer.housingPayment || 0,
          housingIncludedInExpenses: true,
          debtDeclarationStatus: baseLoan ? 'HAS_DEBTS' : 'NO_DEBTS_EXPLICIT',
          debtCount: baseLoan ? 1 : 0,
          totalDebtBalance: baseLoan ? baseLoan.currentPrincipalBalance : 0,
          currentDebtPayments: 0,
        },
        references: [],
        declaredDocumentsSummary: {
          hasIdentityDoc: true,
          hasIncomeEvidence: false,
        },
        status: 'RECIBIDA',
        consentVersion: 'v1.0-Ley172-13',
        consentAcceptedAt: new Date().toISOString(),
        createdBy: userProfile.uid,
        createdByName: safeDisplayName,
      };

      const saved = await submitOrSaveApplication({
        application: renewalApp,
        customer,
        policy: activeOrTestPolicy,
        mode: 'SUBMIT',
        user: userProfile,
      });

      setRenewalResult({
        applicationNumber: saved.application.applicationNumber,
        score: saved.scoring?.totalScore ?? saved.application.latestScore ?? 0,
        prequalificationStatus:
          saved.scoring?.status ?? saved.application.prequalificationStatus ?? 'RECIBIDA',
        recommendedAmount:
          saved.scoring?.recommendedAmount ?? saved.application.recommendedAmount ?? amountNum,
        recommendedInstallment:
          saved.scoring?.recommendedInstallment ?? saved.application.recommendedInstallment ?? 0,
        currency: derivedCurrency,
      });
    } catch (err) {
      setRenewalError(
        formatUserFacingError(err, 'No se pudo enviar la solicitud de renovación.')
      );
    } finally {
      setRenewalSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Client Self-Service Header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#040C1E] border border-[#00B8FF]/25 p-6 text-white shadow-xl">
        <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-infinity-line" />
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00D1FF]">
              Portal de Clientes · {organization.tradeName || organization.name}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Bienvenido, {userProfile?.displayName}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl">
              Consulta el estado de tus préstamos y calendario de cuotas, registra comprobantes de pago y solicita renovaciones o nuevos financiamientos.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('REGISTRAR_PAGO')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-[#00B8FF]/30 text-white text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
            >
              <CreditCard className="w-4 h-4 text-[#00D1FF]" />
              <span>Registrar Pago</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('SOLICITAR_RENOVACION')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shadow-[0_8px_20px_-6px_rgba(0,102,255,0.6)] transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Solicitar Renovación</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('new_application')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#E2B35E]/40 bg-[#E2B35E]/15 hover:bg-[#E2B35E]/25 text-[#E2B35E] text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
            >
              <FilePlus2 className="w-4 h-4" />
              <span>Nueva Solicitud Completa</span>
            </button>
          </div>
        </div>

        {/* Client Web Push VAPID Subscription Bar */}
        {fcmStatus !== 'unsupported' && fcmStatus !== 'vapid_missing' && (
          <div className="mt-4 px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  fcmStatus === 'active'
                    ? 'bg-[#00D1FF]/15 text-[#00D1FF]'
                    : 'bg-white/10 text-slate-300'
                }`}
              >
                {fcmStatus === 'active' ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">
                  {fcmStatus === 'active'
                    ? 'Notificaciones Push activas para tus solicitudes de crédito'
                    : 'Recibe alertas Push cuando cambie el estado de tus solicitudes'}
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  {fcmStatus === 'active'
                    ? 'Te avisaremos automáticamente en Evaluación, Comité, Aprobación, Formalización y Desembolso.'
                    : fcmStatus === 'permission_denied'
                    ? 'Permiso bloqueado en el navegador. Habilita notificaciones en la configuración del sitio.'
                    : fcmStatus === 'error'
                    ? fcmError || 'No fue posible activar las notificaciones Push en este navegador.'
                    : 'Activa la suscripción Push (VAPID) para recibir actualizaciones en tiempo real.'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {fcmStatus === 'active' ? (
                <>
                  <button
                    type="button"
                    disabled={testingClientPush}
                    onClick={async () => {
                      setTestingClientPush(true);
                      try {
                        await sendTestPush();
                      } finally {
                        setTimeout(() => setTestingClientPush(false), 700);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[#00D1FF]/35 bg-[#0066FF]/20 hover:bg-[#0066FF]/35 text-[#7CE4FF] text-[11px] font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50"
                  >
                    {testingClientPush ? 'Enviando...' : 'Probar alerta'}
                  </button>
                  <button
                    type="button"
                    onClick={disableFcmPush}
                    className="px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 text-[11px] font-medium cursor-pointer whitespace-nowrap"
                  >
                    Desactivar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={fcmStatus === 'registering' || fcmStatus === 'permission_denied'}
                  onClick={enableFcmPush}
                  className="px-3 py-1.5 rounded-lg axy-brand-gradient hover:brightness-110 text-white text-[11px] font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  {fcmStatus === 'registering' ? 'Activando...' : 'Activar alertas Push'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="mt-6 pt-4 border-t border-white/10 flex flex-wrap gap-2">
          {[
            { id: 'MIS_PRESTAMOS' as const, label: 'Mis Préstamos y Cuotas', icon: Landmark },
            { id: 'REGISTRAR_PAGO' as const, label: 'Registrar Pago', icon: Receipt },
            { id: 'SOLICITAR_RENOVACION' as const, label: 'Solicitar Renovación', icon: RefreshCw },
            { id: 'MIS_SOLICITUDES' as const, label: 'Mis Solicitudes', icon: FileText },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'axy-brand-gradient text-white shadow-[0_6px_16px_-4px_rgba(0,102,255,0.55)]'
                    : 'bg-[#08132B] text-slate-300 hover:text-white border border-[#00B8FF]/15'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-5 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Préstamos Vigentes</span>
            <Landmark className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
          </div>
          <p className="mt-2 font-display text-2xl font-bold font-mono tabular-nums text-slate-950 dark:text-white">
            {activeLoans.length}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Histórico total: {clientLoans.length} operaciones
          </p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-5 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Capital Pendiente (DOP)</span>
            <Wallet className="w-4 h-4 text-[#00B8FF]" />
          </div>
          <p className="mt-2 font-display text-2xl font-bold font-mono tabular-nums text-slate-950 dark:text-white">
            {formatMoney(totalPendingPrincipalDop, 'DOP')}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Balance de capital actualizado
          </p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-5 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Próxima Cuota</span>
            <CalendarClock className="w-4 h-4 text-[#E2B35E]" />
          </div>
          <p className="mt-2 font-display text-2xl font-bold font-mono tabular-nums text-slate-950 dark:text-white">
            {nextDueInstallment && selectedLoan
              ? formatMoney(nextDueInstallment.totalAmount, selectedLoan.currency)
              : '—'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {nextDueInstallment
              ? `Vence: ${formatShortDate(nextDueInstallment.dueDate)} · Cuota #${nextDueInstallment.installmentNumber}`
              : 'Sin cuotas pendientes'}
          </p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-5 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Pagos Reportados</span>
            <Receipt className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="mt-2 font-display text-2xl font-bold font-mono tabular-nums text-slate-950 dark:text-white">
            {clientPayments.length}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            En verificación:{' '}
            {
              clientPayments.filter(
                (p) => p.status === 'RECIBIDO_PENDIENTE_VERIFICACION' || p.status === 'REPORTADO'
              ).length
            }
          </p>
        </div>
      </section>

      {/* TAB 1: MIS PRÉSTAMOS Y CUOTAS */}
      {activeTab === 'MIS_PRESTAMOS' && (
        <section className="space-y-6">
          {clientLoans.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-8 text-center space-y-4">
              <div className="h-12 w-12 rounded-2xl bg-[#0066FF]/10 text-[#0066FF] dark:text-[#00B8FF] flex items-center justify-center mx-auto">
                <Landmark className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h2 className="font-display text-lg font-bold text-slate-950 dark:text-white">
                  Aún no tienes préstamos desembolsados
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Puedes iniciar una nueva solicitud de crédito en minutos y dar seguimiento en línea desde este portal.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveSection('new_application')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl axy-brand-gradient text-white text-xs font-semibold cursor-pointer"
                >
                  <FilePlus2 className="w-4 h-4" />
                  <span>Solicitar Primer Préstamo</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('MIS_SOLICITUDES')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <span>Ver Mis Solicitudes ({applications.length})</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Loan Cards List */}
              <div className="lg:col-span-5 space-y-3">
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Tus Préstamos ({clientLoans.length})
                </h2>
                {clientLoans.map((loan) => {
                  const isSelected = selectedLoan?.id === loan.id;
                  const paidPct =
                    loan.totalFinancedPrincipal > 0
                      ? Math.min(
                          100,
                          Math.max(
                            0,
                            Math.round(
                              ((loan.totalFinancedPrincipal - loan.currentPrincipalBalance) /
                                loan.totalFinancedPrincipal) *
                                100
                            )
                          )
                        )
                      : 0;
                  return (
                    <div
                      key={loan.id}
                      onClick={() => setSelectedLoanId(loan.id)}
                      className={`rounded-2xl border p-5 transition-all cursor-pointer space-y-3 ${
                        isSelected
                          ? 'bg-white dark:bg-[#08132B] border-[#0066FF] dark:border-[#00B8FF] shadow-[0_8px_24px_-10px_rgba(0,102,255,0.28)]'
                          : 'bg-white/90 dark:bg-[#08132B]/75 border-slate-200/85 dark:border-[#00B8FF]/15 hover:border-[#00B8FF]/45'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-mono text-xs font-bold text-[#0052CC] dark:text-[#00D1FF]">
                            {loan.loanNumber}
                          </p>
                          <p className="font-display text-base font-bold text-slate-950 dark:text-white mt-0.5">
                            {formatMoney(loan.currentPrincipalBalance, loan.currency)}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Saldo pendiente de {formatMoney(loan.totalFinancedPrincipal, loan.currency)}
                          </p>
                        </div>
                        <span
                          className={`text-xs font-mono font-bold ${
                            loan.status === 'ACTIVO'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : loan.status === 'VENCIDO'
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {loan.status}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          <span>Amortizado {paidPct}%</span>
                          <span>
                            {loan.termMonths} cuotas · {loan.frequency} · Tasa{' '}
                            {formatRatePct(loan.contractualRateMonthly)}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-[#040C1E] overflow-hidden">
                          <div
                            className="h-full axy-brand-gradient"
                            style={{ width: `${paidPct}%` }}
                          />
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100 dark:border-white/[0.06] flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openPaymentForLoan(loan);
                          }}
                          className="px-3 py-1.5 rounded-lg axy-brand-gradient text-white text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                        >
                          Registrar Pago
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openRenewalForLoan(loan);
                          }}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#00B8FF]/25 hover:bg-slate-50 dark:hover:bg-white/[0.04] text-slate-800 dark:text-slate-200 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                        >
                          Solicitar Renovación
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Installment Schedule */}
              <div className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-5 sm:p-6 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-950 dark:text-white">
                      Calendario de Cuotas · {selectedLoan?.loanNumber}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Desembolso {formatShortDate(selectedLoan?.disbursementDate)} · Vencimiento{' '}
                      {formatShortDate(selectedLoan?.maturityDate)}
                    </p>
                  </div>
                  {selectedLoan && (
                    <button
                      type="button"
                      onClick={() => openPaymentForLoan(selectedLoan)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0066FF]/10 text-[#0052CC] dark:text-[#00D1FF] text-xs font-semibold hover:bg-[#0066FF]/20 cursor-pointer whitespace-nowrap"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>Reportar Pago de Cuota</span>
                    </button>
                  )}
                </div>

                {loadingInstallments ? (
                  <p className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                    Cargando tabla de cuotas del préstamo...
                  </p>
                ) : installments.length === 0 ? (
                  <p className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                    No se encontraron cuotas generadas para este préstamo.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-white/10 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          <th className="py-2.5 pr-3">#</th>
                          <th className="py-2.5 pr-3">Vencimiento</th>
                          <th className="py-2.5 pr-3 text-right">Capital</th>
                          <th className="py-2.5 pr-3 text-right">Interés</th>
                          <th className="py-2.5 pr-3 text-right">Cuota Total</th>
                          <th className="py-2.5 pr-3 text-right">Saldo</th>
                          <th className="py-2.5 text-right">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06] font-mono tabular-nums">
                        {installments.map((inst) => {
                          const meta = INSTALLMENT_STATUS_META[inst.status] || {
                            label: inst.status,
                            colorClass: 'text-slate-500',
                          };
                          return (
                            <tr
                              key={inst.id}
                              className="hover:bg-slate-50/80 dark:hover:bg-white/[0.02]"
                            >
                              <td className="py-2.5 pr-3 font-bold text-slate-900 dark:text-white">
                                #{inst.installmentNumber}
                              </td>
                              <td className="py-2.5 pr-3 font-sans text-slate-600 dark:text-slate-300">
                                {formatShortDate(inst.dueDate)}
                              </td>
                              <td className="py-2.5 pr-3 text-right text-slate-700 dark:text-slate-300">
                                {formatMoney(inst.principalAmount, selectedLoan?.currency || 'DOP')}
                              </td>
                              <td className="py-2.5 pr-3 text-right text-slate-700 dark:text-slate-300">
                                {formatMoney(inst.interestAmount, selectedLoan?.currency || 'DOP')}
                              </td>
                              <td className="py-2.5 pr-3 text-right font-bold text-slate-950 dark:text-white">
                                {formatMoney(inst.totalAmount, selectedLoan?.currency || 'DOP')}
                              </td>
                              <td className="py-2.5 pr-3 text-right text-slate-500 dark:text-slate-400">
                                {formatMoney(
                                  inst.remainingPrincipalBalance,
                                  selectedLoan?.currency || 'DOP'
                                )}
                              </td>
                              <td className={`py-2.5 text-right font-sans font-semibold ${meta.colorClass}`}>
                                {meta.label}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* TAB 2: REGISTRAR PAGO */}
      {activeTab === 'REGISTRAR_PAGO' && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-6 shadow-xs space-y-5">
            <div>
              <h2 className="font-display text-base font-bold text-slate-950 dark:text-white">
                Registrar Comprobante de Pago
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Tu pago ingresará a conciliación bancaria y se aplicará a tu calendario tras validación de Tesorería.
              </p>
            </div>

            {payError && (
              <div className="p-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{payError}</span>
              </div>
            )}

            {paySuccess && (
              <div className="p-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-200 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{paySuccess}</span>
              </div>
            )}

            <form onSubmit={handleRegisterPayment} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Préstamo a abonar
                </label>
                <select
                  value={payLoanId}
                  onChange={(e) => setPayLoanId(e.target.value)}
                  disabled={clientLoans.length === 0}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                >
                  {clientLoans.length === 0 ? (
                    <option value="">No hay préstamos activos</option>
                  ) : (
                    clientLoans.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.loanNumber} · Saldo {formatMoney(l.currentPrincipalBalance, l.currency)}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Monto pagado *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="Ej. 10500.00"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Fecha del pago *
                  </label>
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Canal / Método *
                  </label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentChannelMethod)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Banco / Entidad
                  </label>
                  <input
                    type="text"
                    value={payBankName}
                    onChange={(e) => setPayBankName(e.target.value)}
                    placeholder="Ej. Banreservas, BHD, Popular"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Número de referencia / comprobante *
                </label>
                <input
                  type="text"
                  required
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                  placeholder="Ej. TRF-8943021"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Subir comprobante de pago (opcional · Imagen o PDF)
                </label>
                <label className="inline-flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-[#00B8FF]/30 bg-slate-50 dark:bg-[#040C1E] hover:border-[#0066FF] text-slate-700 dark:text-slate-200 font-semibold cursor-pointer">
                  <Upload className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                  <span>{payEvidenceFile ? 'Cambiar comprobante' : 'Seleccionar imagen o PDF del comprobante'}</span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => void handlePayEvidenceSelect(e)}
                    className="hidden"
                  />
                </label>
                {payEvidenceError && (
                  <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{payEvidenceError}</p>
                )}
                {payEvidenceFile && (
                  <div className="mt-2 flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70">
                    <span className="inline-flex items-center gap-1.5 text-emerald-800 dark:text-emerald-200 truncate">
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{payEvidenceFile.fileName}</span>
                      <span className="font-mono text-[10px]">
                        ({formatEvidenceFileSize(payEvidenceFile.sizeBytes)})
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPayEvidenceFile(null)}
                      className="p-0.5 text-emerald-700 hover:text-rose-600 cursor-pointer"
                      aria-label="Quitar comprobante"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Observaciones (opcional)
                </label>
                <textarea
                  rows={2}
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="Cuota correspondiente, cuenta origen o detalle adicional..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                />
              </div>

              <button
                type="submit"
                disabled={paySubmitting || clientLoans.length === 0}
                className="w-full py-2.5 px-4 rounded-xl axy-brand-gradient hover:brightness-110 text-white font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{paySubmitting ? 'Registrando pago...' : 'Enviar Reporte de Pago'}</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-6 shadow-xs space-y-4">
            <div>
              <h2 className="font-display text-base font-bold text-slate-950 dark:text-white">
                Historial de Pagos Reportados ({clientPayments.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Seguimiento en tiempo real desde reporte hasta validación en Contabilidad y aplicación en cuotas.
              </p>
            </div>

            {clientPayments.length === 0 ? (
              <p className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                Aún no has registrado pagos desde el portal.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/10 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <th className="py-2.5 pr-3">Fecha</th>
                      <th className="py-2.5 pr-3">Préstamo</th>
                      <th className="py-2.5 pr-3">Referencia</th>
                      <th className="py-2.5 pr-3">Comprobante</th>
                      <th className="py-2.5 pr-3 text-right">Monto</th>
                      <th className="py-2.5 text-right">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06] font-mono tabular-nums">
                    {clientPayments.map((p) => {
                      const isPending = isPaymentPendingValidation(p.status);
                      const isUploading = uploadingPaymentId === p.id;
                      return (
                        <tr key={p.id}>
                          <td className="py-2.5 pr-3 font-sans text-slate-600 dark:text-slate-300">
                            {formatShortDate(p.paymentDate)}
                          </td>
                          <td className="py-2.5 pr-3 font-bold text-slate-900 dark:text-white">
                            {p.loanNumber}
                          </td>
                          <td className="py-2.5 pr-3 text-slate-500 dark:text-slate-400">
                            {p.referenceNumber} · {p.method}
                          </td>
                          <td className="py-2.5 pr-3 font-sans">
                            {p.receiptEvidenceDataUrl ? (
                              <button
                                type="button"
                                onClick={() => setPreviewPayment(p)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-sky-200 dark:border-[#00B8FF]/30 bg-sky-50 dark:bg-[#0066FF]/15 text-[#0052CC] dark:text-[#00D1FF] text-[11px] font-semibold cursor-pointer"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Ver</span>
                              </button>
                            ) : isPending ? (
                              <label className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-[#00B8FF]/25 hover:bg-slate-50 dark:hover:bg-white/5 text-[11px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                                <Upload className="w-3 h-3" />
                                <span>{isUploading ? 'Subiendo…' : 'Subir'}</span>
                                <input
                                  type="file"
                                  accept="image/*,application/pdf"
                                  disabled={isUploading}
                                  onChange={(e) => void handleInlineAttachEvidence(p, e)}
                                  className="hidden"
                                />
                              </label>
                            ) : (
                              <span className="text-[11px] text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-bold text-slate-950 dark:text-white">
                            {formatMoney(p.amount, p.currency)}
                          </td>
                          <td
                            className={`py-2.5 text-right font-sans font-semibold ${
                              p.status === 'APLICADO'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : p.status === 'RECHAZADO' || p.status === 'REVERTIDO'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-amber-600 dark:text-[#E2B35E]'
                            }`}
                          >
                            {PAYMENT_STATUS_LABELS[p.status] || getPaymentValidationStatusLabel(p.status)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB 3: SOLICITAR RENOVACIÓN */}
      {activeTab === 'SOLICITAR_RENOVACION' && (
        <section className="max-w-3xl mx-auto rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-6 sm:p-8 shadow-xs space-y-5">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-950 dark:text-white">
              Solicitud Exprés de Renovación de Crédito
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Precalifica automáticamente tu renovación con el Motor de Decisiones AxyCore V2 y envíala a evaluación prioritaria.
            </p>
          </div>

          {renewalError && (
            <div className="p-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{renewalError}</span>
            </div>
          )}

          {renewalResult && (
            <div className="p-5 rounded-2xl bg-[#040C1E] border border-[#00B8FF]/35 text-white space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                <CheckCircle2 className="w-4 h-4" />
                <span>Solicitud de Renovación Recibida · {renewalResult.applicationNumber}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Precalificación Motor V2</span>
                  <span className="font-bold text-[#00D1FF]">{renewalResult.prequalificationStatus}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Score Crediticio</span>
                  <span className="font-mono font-bold tabular-nums">{renewalResult.score} / 100</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Monto / Cuota Estimada</span>
                  <span className="font-mono font-bold tabular-nums">
                    {formatMoney(renewalResult.recommendedAmount, renewalResult.currency)} ·{' '}
                    {formatMoney(renewalResult.recommendedInstallment, renewalResult.currency)}/mes
                  </span>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmitRenewal} className="space-y-4 text-xs">
            {clientLoans.length > 0 && (
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Préstamo base a renovar
                </label>
                <select
                  value={renewalBaseLoanId}
                  onChange={(e) => setRenewalBaseLoanId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                >
                  {clientLoans.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.loanNumber} · Original {formatMoney(l.approvedPrincipal, l.currency)} · Saldo{' '}
                      {formatMoney(l.currentPrincipalBalance, l.currency)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {!existingClientCustomer && (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#040C1E]/70 border border-slate-200 dark:border-[#00B8FF]/15 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Cédula / Pasaporte *
                  </label>
                  <input
                    type="text"
                    required
                    value={renewalDocNumber}
                    onChange={(e) => setRenewalDocNumber(e.target.value)}
                    placeholder="001-0000000-0"
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Teléfono móvil *
                  </label>
                  <input
                    type="text"
                    required
                    value={renewalPhone}
                    onChange={(e) => setRenewalPhone(e.target.value)}
                    placeholder="809-555-0100"
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Dirección
                  </label>
                  <input
                    type="text"
                    value={renewalAddress}
                    onChange={(e) => setRenewalAddress(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Producto financiero *
                </label>
                <select
                  value={renewalProductCode}
                  onChange={(e) => setRenewalProductCode(e.target.value as ProductCode)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                >
                  <option value="PERSONAL_DOP">Personal DOP (RD$)</option>
                  <option value="EMPRESARIAL_DOP">Empresarial DOP (RD$)</option>
                  <option value="PERSONAL_USD">Personal USD (US$)</option>
                  <option value="EMPRESARIAL_USD">Empresarial USD (US$)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Monto solicitado *
                </label>
                <input
                  type="number"
                  min="500"
                  step="100"
                  required
                  value={renewalAmount}
                  onChange={(e) => setRenewalAmount(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Plazo (meses) y frecuencia *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min="1"
                    max="60"
                    required
                    value={renewalTermMonths}
                    onChange={(e) => setRenewalTermMonths(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                  />
                  <select
                    value={renewalFrequency}
                    onChange={(e) => setRenewalFrequency(e.target.value as PaymentFrequency)}
                    className="w-full px-2 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                  >
                    <option value="MENSUAL">Mensual</option>
                    <option value="QUINCENAL">Quincenal</option>
                    <option value="SEMANAL">Semanal</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Ingresos mensuales netos actuales *
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={renewalMonthlyIncome}
                  onChange={(e) => setRenewalMonthlyIncome(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Gastos esenciales mensuales
                </label>
                <input
                  type="number"
                  min="0"
                  value={renewalEssentialExpenses}
                  onChange={(e) => setRenewalEssentialExpenses(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Motivo o destino de la renovación
              </label>
              <textarea
                rows={2}
                value={renewalPurposeNotes}
                onChange={(e) => setRenewalPurposeNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
              />
            </div>

            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E]/70 border border-slate-200 dark:border-[#00B8FF]/15 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={renewalConsent}
                onChange={(e) => setRenewalConsent(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 dark:border-slate-600 dark:bg-[#040C1E] text-[#0066FF]"
              />
              <span className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                Confirmo que la información suministrada es verídica y autorizo a{' '}
                <strong>{organization.tradeName || organization.name}</strong> el análisis crediticio conforme a la Ley 172-13.
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => setActiveSection('new_application')}
                className="text-xs font-semibold text-[#0052CC] dark:text-[#00D1FF] hover:underline cursor-pointer"
              >
                ¿Prefieres llenar la solicitud completa con documentos? Abrir formulario
              </button>

              <button
                type="submit"
                disabled={renewalSubmitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl axy-brand-gradient hover:brightness-110 text-white font-semibold transition-all disabled:opacity-50 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {renewalSubmitting ? 'Precalificando renovación...' : 'Enviar Solicitud de Renovación'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
        </section>
      )}

      {/* TAB 4: MIS SOLICITUDES */}
      {activeTab === 'MIS_SOLICITUDES' && (
        <section className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-950 dark:text-white">
                Mis Solicitudes de Crédito y Renovaciones ({applications.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Estado en vivo de cada expediente ingresado en {organization.tradeName || organization.name}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveSection('new_application')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl axy-brand-gradient text-white text-xs font-semibold cursor-pointer"
            >
              <FilePlus2 className="w-4 h-4" />
              <span>Nueva Solicitud de Crédito</span>
            </button>
          </div>

          {applications.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No tienes solicitudes registradas aún.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/10 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-3">Número</th>
                    <th className="py-2.5 pr-3">Propósito / Producto</th>
                    <th className="py-2.5 pr-3 text-right">Monto Solicitado</th>
                    <th className="py-2.5 pr-3 text-right">Score</th>
                    <th className="py-2.5 text-right">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                  {applications.map((app) => (
                    <tr key={app.id}>
                      <td className="py-2.5 pr-3 font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">
                        {app.applicationNumber}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700 dark:text-slate-200">
                        <span className="font-medium">{app.loanPurpose || app.productCode}</span>
                        <span className="block text-[11px] text-slate-400 font-mono">
                          {app.requestedTermMonths} meses · {app.paymentFrequency}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-bold text-slate-950 dark:text-white">
                        {formatMoney(app.requestedAmount, app.currency)}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {app.latestScore !== undefined ? `${app.latestScore}/100` : '—'}
                      </td>
                      <td className="py-2.5 text-right font-semibold text-slate-900 dark:text-white">
                        {APPLICATION_STATUS_LABELS[app.status] || app.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <PaymentEvidencePreviewModal
        payment={previewPayment}
        onClose={() => setPreviewPayment(null)}
      />
    </div>
  );
}
