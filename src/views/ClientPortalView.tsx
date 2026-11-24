import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  BellOff,
  Calculator,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Eye,
  FilePlus2,
  FileText,
  HeartHandshake,
  Landmark,
  Link2,
  MessageCircle,
  MessageSquarePlus,
  Receipt,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  analyzeLoanHealth,
  simulateClientRenewal,
} from '../engine/clientPortalHealthEngine';
import {
  CLIENT_SERVICE_REQUEST_CATALOG,
  CLIENT_SERVICE_REQUEST_STATUS_LABELS,
  getServiceRequestCatalogItem,
} from '../engine/externalPortalEngine';
import { createClientServiceRequest } from '../services/externalPortalService';
import { ClientAmortizationPanel } from '../components/clientPortal/ClientAmortizationPanel';
import { ClientCreditHealthHero } from '../components/clientPortal/ClientCreditHealthHero';
import { ClientHardshipReliefTab } from '../components/clientPortal/ClientHardshipReliefTab';
import { ClientMessagingCenter } from '../components/clientPortal/ClientMessagingCenter';
import { InstitutionalLogoBadge } from '../components/InstitutionalLogoBadge';
import { PaymentEvidencePreviewModal } from '../components/PaymentEvidencePreviewModal';
import { PaymentReceiptModal } from '../components/PaymentReceiptModal';
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
  ClientServiceRequestType,
  CollectionReceiptRecord,
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
  | 'ALIVIO_FINANCIERO'
  | 'MENSAJES_ADMIN'
  | 'GESTIONES_SERVICIO'
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

export function ClientPortalView() {
  const {
    userProfile,
    organization,
    loans,
    payments,
    collectionReceipts,
    applications,
    customers,
    activeOrTestPolicy,
    setActiveSection,
    fcmStatus,
    fcmError,
    enableFcmPush,
    disableFcmPush,
    sendTestPush,
    clientServiceRequests,
    clientPortalMessages,
    verifyAndLinkClientProfile,
  } = useAxyCore();
  const [testingClientPush, setTestingClientPush] = useState(false);

  const [activeTab, setActiveTab] = useState<ClientPortalTab>('MIS_PRESTAMOS');
  const [selectedLoanId, setSelectedLoanId] = useState<string>('');
  const [installments, setInstallments] = useState<LoanInstallmentRecord[]>([]);
  const [loadingInstallments, setLoadingInstallments] = useState(false);

  // Zero-Trust Borrower Identity Linking state
  const [linkDocType, setLinkDocType] = useState<'CEDULA' | 'PASAPORTE'>('CEDULA');
  const [linkDocNumber, setLinkDocNumber] = useState('');
  const [linkPhone, setLinkPhone] = useState('');
  const [linkingProfile, setLinkingProfile] = useState(false);
  const [linkFeedback, setLinkFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showLinkPanel, setShowLinkPanel] = useState(false);

  // Self-Service Requests Hub state
  const [reqType, setReqType] = useState<ClientServiceRequestType>('CARTA_SALDO');
  const [reqLoanId, setReqLoanId] = useState<string>('');
  const [reqSubject, setReqSubject] = useState<string>('');
  const [reqDetails, setReqDetails] = useState<string>('');
  const [reqAmount, setReqAmount] = useState<string>('');
  const [reqDate, setReqDate] = useState<string>('');
  const [reqPhone, setReqPhone] = useState<string>('');
  const [reqDocNumber, setReqDocNumber] = useState<string>('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqFeedback, setReqFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

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
  const [previewReceipt, setPreviewReceipt] = useState<CollectionReceiptRecord | null>(null);
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
    if (selectedLoan && !reqLoanId) {
      setReqLoanId(selectedLoan.id);
    }
  }, [selectedLoan, selectedLoanId, payLoanId, renewalBaseLoanId, reqLoanId]);

  const sortedServiceRequests = useMemo(() => {
    return [...clientServiceRequests].sort((a, b) =>
      String(b.ticketNumber || '').localeCompare(String(a.ticketNumber || ''))
    );
  }, [clientServiceRequests]);

  const selectedReqCatalog = useMemo(() => getServiceRequestCatalogItem(reqType), [reqType]);

  const handleVerifyAndLinkAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinkingProfile(true);
    setLinkFeedback(null);
    try {
      const res = await verifyAndLinkClientProfile({
        documentType: linkDocType,
        documentNumber: linkDocNumber.trim(),
        phone: linkPhone.trim(),
      });
      setLinkFeedback({ type: res.linked ? 'ok' : 'err', text: res.message });
      if (res.linked) {
        setShowLinkPanel(false);
      }
    } catch (err) {
      setLinkFeedback({
        type: 'err',
        text: formatUserFacingError(err, 'No se pudo validar tu expediente en este momento.'),
      });
    } finally {
      setLinkingProfile(false);
    }
  };

  const handleSubmitServiceRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    setReqFeedback(null);

    const catalogItem = getServiceRequestCatalogItem(reqType);
    const effectiveSubject = reqSubject.trim() || catalogItem.label;
    if (reqDetails.trim().length < 5) {
      setReqFeedback({
        type: 'err',
        text: 'Describe brevemente tu solicitud para que un oficial pueda gestionarla con precisión.',
      });
      return;
    }

    const effectiveOrgId = userProfile.organizationId || organization.id || DEFAULT_ORG_ID;
    const matchedLoan = clientLoans.find((l) => l.id === reqLoanId) || null;
    const parsedAmt = reqAmount.trim() ? Number(reqAmount) : null;

    setReqSubmitting(true);
    try {
      const created = await createClientServiceRequest({
        user: userProfile,
        organizationId: effectiveOrgId,
        requestType: reqType,
        subject: effectiveSubject,
        details: reqDetails.trim(),
        customerId: userProfile.linkedCustomerId || existingClientCustomer?.id || null,
        loanId: matchedLoan?.id || null,
        loanNumber: matchedLoan?.loanNumber || null,
        requestedAmount: parsedAmt !== null && Number.isFinite(parsedAmt) ? parsedAmt : null,
        requestedDate: reqDate.trim() || null,
        contactPhone: reqPhone.trim() || existingClientCustomer?.phone || null,
        documentNumber: reqDocNumber.trim() || existingClientCustomer?.documentNumber || null,
      });
      setReqFeedback({
        type: 'ok',
        text: `Gestión ${created.ticketNumber} enviada correctamente a ${
          organization.tradeName || organization.name
        }. Podrás ver la respuesta oficial aquí mismo.`,
      });
      setReqSubject('');
      setReqDetails('');
      setReqAmount('');
      setReqDate('');
    } catch (err) {
      setReqFeedback({
        type: 'err',
        text: formatUserFacingError(err, 'No se pudo enviar tu gestión en este momento.'),
      });
    } finally {
      setReqSubmitting(false);
    }
  };

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

  const selectedLoanHealth = useMemo(() => {
    if (!selectedLoan) return null;
    return analyzeLoanHealth(selectedLoan, installments);
  }, [selectedLoan, installments]);

  const unreadAdminMessagesCount = useMemo(() => {
    if (!userProfile) return 0;
    return clientPortalMessages.filter(
      (m) => m.clientUid === userProfile.uid && m.senderRole === 'ADMIN_STAFF' && !m.readByClient
    ).length;
  }, [clientPortalMessages, userProfile]);

  const renewalBaseLoan = useMemo(
    () => clientLoans.find((l) => l.id === renewalBaseLoanId) || selectedLoan || null,
    [clientLoans, renewalBaseLoanId, selectedLoan]
  );

  const renewalSimulation = useMemo(() => {
    if (!renewalBaseLoan) return null;
    const reqAmt = Number(renewalAmount) || 0;
    const reqTerm = Number(renewalTermMonths) || 12;
    const baseInstallments =
      selectedLoan && renewalBaseLoan.id === selectedLoan.id ? installments : [];
    return simulateClientRenewal({
      baseLoan: renewalBaseLoan,
      installments: baseInstallments,
      requestedAmount: reqAmt,
      requestedTermMonths: reqTerm,
      frequency: renewalFrequency,
    });
  }, [renewalBaseLoan, renewalAmount, renewalTermMonths, renewalFrequency, selectedLoan, installments]);

  const openPaymentWithPrefill = (loan: LoanRecord, amount?: number, note?: string) => {
    setPayLoanId(loan.id);
    setSelectedLoanId(loan.id);
    if (typeof amount === 'number' && amount > 0) {
      setPayAmount(amount.toFixed(2));
    } else if (nextDueInstallment && nextDueInstallment.loanId === loan.id) {
      setPayAmount(String(nextDueInstallment.totalAmount));
    } else if (!payAmount) {
      const approxCuota =
        loan.termMonths > 0
          ? Math.round((loan.totalFinancedPrincipal / loan.termMonths) * (1 + loan.contractualRateMonthly))
          : 0;
      setPayAmount(approxCuota > 0 ? String(approxCuota) : '');
    }
    if (note) {
      setPayNotes(note);
    }
    setPayError(null);
    setPaySuccess(null);
    setActiveTab('REGISTRAR_PAGO');
  };

  const openRenewalForLoan = (loan: LoanRecord) => {
    setRenewalBaseLoanId(loan.id);
    setRenewalProductCode(loan.productCode);
    const suggestedAmt = Math.max(
      loan.approvedPrincipal || 75000,
      Math.ceil(((loan.currentPrincipalBalance || 0) * 1.35) / 1000) * 1000
    );
    setRenewalAmount(String(suggestedAmt));
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
      {/* Client Self-Service Command Header */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#040C1E] via-[#071530] to-[#0A1E44] border border-[#00B8FF]/25 p-6 text-white shadow-xl">
        <div aria-hidden="true" className="absolute top-0 inset-x-0 h-[2px] axy-infinity-line" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[#0066FF]/15 blur-3xl"
        />

        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="flex items-start gap-4 min-w-0">
            <InstitutionalLogoBadge
              logoUrl={organization.logoUrl}
              name={organization.tradeName || organization.name}
              primaryColor={organization.primaryColor}
              accentColor={organization.accentColor}
              size="lg"
              className="mt-0.5"
            />
            <div className="space-y-1.5 min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00D1FF]">
                Espacio de Autogestión · {organization.tradeName || organization.name}
                {organization.phone ? ` · Tel. ${organization.phone}` : ''}
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Hola, {userProfile?.displayName}
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 max-w-2xl">
                Controla tu tabla de amortización, estatus crediticio, pagos, renovaciones, planes de alivio y mensajería directa con los administradores de tu institución.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('REGISTRAR_PAGO')}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-[#00B8FF]/30 text-white text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
            >
              <CreditCard className="w-4 h-4 text-[#00D1FF]" />
              <span>Realizar Pago</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('MENSAJES_ADMIN')}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-emerald-400/30 text-white text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
            >
              <MessageCircle className="w-4 h-4 text-emerald-400" />
              <span>Mensajes a Admin</span>
              {unreadAdminMessagesCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-md bg-emerald-500 text-[10px] font-mono font-bold text-white leading-none">
                  {unreadAdminMessagesCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('SOLICITAR_RENOVACION')}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl axy-brand-gradient hover:brightness-110 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shadow-[0_8px_20px_-6px_rgba(0,102,255,0.6)] transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Renovar Crédito</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('new_application')}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-[#E2B35E]/40 bg-[#E2B35E]/15 hover:bg-[#E2B35E]/25 text-[#E2B35E] text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
            >
              <FilePlus2 className="w-4 h-4" />
              <span>Nueva Solicitud</span>
            </button>
          </div>
        </div>

        {/* Client Web Push VAPID Subscription Bar */}
        {fcmStatus !== 'unsupported' && fcmStatus !== 'vapid_missing' && (
          <div className="relative mt-4 px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
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
                    ? 'Notificaciones Push activas para tus préstamos y solicitudes'
                    : 'Recibe alertas Push cuando cambie el estado de tus solicitudes o pagos'}
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
        <div className="relative mt-5 pt-4 border-t border-white/10 flex flex-wrap gap-2">
          {[
            { id: 'MIS_PRESTAMOS' as const, label: 'Mi Crédito y Amortización', icon: Landmark },
            { id: 'REGISTRAR_PAGO' as const, label: 'Realizar Pago', icon: Receipt },
            { id: 'SOLICITAR_RENOVACION' as const, label: 'Renovación', icon: RefreshCw },
            {
              id: 'ALIVIO_FINANCIERO' as const,
              label: selectedLoanHealth?.needsHardshipAssistance
                ? 'Ayuda por Atraso · Disponible'
                : 'Ayuda por Atraso',
              icon: HeartHandshake,
              highlightAlert: Boolean(selectedLoanHealth?.needsHardshipAssistance),
            },
            {
              id: 'MENSAJES_ADMIN' as const,
              label:
                unreadAdminMessagesCount > 0
                  ? `Mensajes (${unreadAdminMessagesCount} nuevos)`
                  : 'Mensajes a Admin',
              icon: MessageCircle,
            },
            {
              id: 'GESTIONES_SERVICIO' as const,
              label: `Gestiones (${sortedServiceRequests.length})`,
              icon: MessageSquarePlus,
            },
            {
              id: 'MIS_SOLICITUDES' as const,
              label: `Solicitudes (${applications.length})`,
              icon: FileText,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const isAlert = 'highlightAlert' in tab && tab.highlightAlert && !isActive;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'axy-brand-gradient text-white shadow-[0_6px_16px_-4px_rgba(0,102,255,0.55)]'
                    : isAlert
                    ? 'bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 border border-rose-400/40'
                    : 'bg-[#08132B]/90 text-slate-300 hover:text-white border border-[#00B8FF]/15'
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
          {/* Borrower Identity Linking Card (visible when not linked yet, or toggled manually) */}
          {(!userProfile?.linkedCustomerId && (clientLoans.length === 0 || showLinkPanel)) && (
            <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-[#0066FF]/25 dark:border-[#00B8FF]/30 p-5 sm:p-6 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-slate-200/80 dark:border-white/10 pb-3.5">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-[#0066FF]/10 text-[#0066FF] dark:text-[#00D1FF] flex items-center justify-center shrink-0">
                    <Link2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-950 dark:text-white">
                      ¿Ya tienes préstamos en {organization.tradeName || organization.name}?
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                      Valida tu cédula y teléfono registrado para vincular tu expediente al instante y consultar tus préstamos, cuotas, montos y pagos históricos.
                    </p>
                  </div>
                </div>
                {clientLoans.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowLinkPanel(false)}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer shrink-0"
                  >
                    Ocultar
                  </button>
                )}
              </div>

              {linkFeedback && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                    linkFeedback.type === 'ok'
                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                      : 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                  }`}
                >
                  {linkFeedback.type === 'ok' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1.5">
                    <p>{linkFeedback.text}</p>
                    {linkFeedback.type === 'err' && (
                      <button
                        type="button"
                        onClick={() => {
                          setReqType('VINCULACION_EXPEDIENTE');
                          setReqDocNumber(linkDocNumber);
                          setReqPhone(linkPhone);
                          setReqSubject('Solicitud de vinculación de expediente y préstamos');
                          setReqDetails(
                            `Solicito vincular mi cuenta de portal (${userProfile?.email || ''}) con mi expediente de cliente. Documento: ${linkDocNumber || 'pendiente'}, Teléfono: ${linkPhone || 'pendiente'}.`
                          );
                          setActiveTab('GESTIONES_SERVICIO');
                        }}
                        className="font-semibold underline text-[#0052CC] dark:text-[#00D1FF] cursor-pointer"
                      >
                        Enviar solicitud a un oficial para vincular mi expediente →
                      </button>
                    )}
                  </div>
                </div>
              )}

              <form onSubmit={handleVerifyAndLinkAccount} className="grid grid-cols-1 sm:grid-cols-12 gap-3 text-xs items-end">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tipo
                  </label>
                  <select
                    value={linkDocType}
                    onChange={(e) => setLinkDocType(e.target.value as 'CEDULA' | 'PASAPORTE')}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                  >
                    <option value="CEDULA">Cédula</option>
                    <option value="PASAPORTE">Pasaporte</option>
                  </select>
                </div>
                <div className="sm:col-span-4">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Número de cédula / documento
                  </label>
                  <input
                    type="text"
                    value={linkDocNumber}
                    onChange={(e) => setLinkDocNumber(e.target.value)}
                    placeholder="Ej. 001-0000000-0"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Teléfono registrado
                  </label>
                  <input
                    type="text"
                    value={linkPhone}
                    onChange={(e) => setLinkPhone(e.target.value)}
                    placeholder="Ej. 809-555-0100"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div className="sm:col-span-3">
                  <button
                    type="submit"
                    disabled={linkingProfile}
                    className="w-full py-2.5 px-4 rounded-xl axy-brand-gradient hover:brightness-110 text-white font-semibold cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-2"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>{linkingProfile ? 'Validando...' : 'Validar y Vincular'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {clientLoans.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-8 text-center space-y-4">
              <div className="h-12 w-12 rounded-2xl bg-[#0066FF]/10 text-[#0066FF] dark:text-[#00B8FF] flex items-center justify-center mx-auto">
                <Landmark className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h2 className="font-display text-lg font-bold text-slate-950 dark:text-white">
                  Aún no tienes préstamos visibles en tu cuenta
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Si eres cliente nuevo, completa tu solicitud de crédito en minutos. Si ya tienes préstamos activos con nosotros, vincúlalos arriba con tu cédula y teléfono.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveSection('new_application')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl axy-brand-gradient text-white text-xs font-semibold cursor-pointer"
                >
                  <FilePlus2 className="w-4 h-4" />
                  <span>Solicitar Nuevo Préstamo</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('GESTIONES_SERVICIO')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                  <span>Enviar una Gestión / Solicitud</span>
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
          ) : selectedLoan && selectedLoanHealth ? (
            <div className="space-y-6">
              <ClientCreditHealthHero
                loans={clientLoans}
                selectedLoan={selectedLoan}
                health={selectedLoanHealth}
                onSelectLoan={(loanId) => setSelectedLoanId(loanId)}
                onPayNextInstallment={(amount, note) =>
                  openPaymentWithPrefill(selectedLoan, amount, note)
                }
                onOpenRenewal={() => openRenewalForLoan(selectedLoan)}
                onOpenHardshipRelief={() => setActiveTab('ALIVIO_FINANCIERO')}
                onOpenMessages={() => setActiveTab('MENSAJES_ADMIN')}
              />

              <ClientAmortizationPanel
                loan={selectedLoan}
                installments={installments}
                loading={loadingInstallments}
                onPayInstallment={(amount, installmentNumber, dueDate) =>
                  openPaymentWithPrefill(
                    selectedLoan,
                    amount,
                    `Pago Cuota #${installmentNumber} (vence ${dueDate}) · ${selectedLoan.loanNumber}`
                  )
                }
              />
            </div>
          ) : null}
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

              {/* 1-Click Quick-Fill Payment Buttons */}
              {selectedLoan && selectedLoanHealth && payLoanId === selectedLoan.id && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    Autocompletar monto rápido
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {selectedLoanHealth.nextDueRemainingAmount > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setPayAmount(selectedLoanHealth.nextDueRemainingAmount.toFixed(2));
                          if (selectedLoanHealth.nextDueInstallment) {
                            setPayNotes(
                              `Pago Cuota #${selectedLoanHealth.nextDueInstallment.installmentNumber} · ${selectedLoan.loanNumber}`
                            );
                          }
                        }}
                        className="text-left px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] hover:bg-[#0066FF]/10 border border-slate-200 dark:border-[#00B8FF]/20 transition-colors cursor-pointer"
                      >
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Próxima cuota
                        </span>
                        <span className="font-mono tabular-nums text-xs font-bold text-slate-950 dark:text-white">
                          {formatMoney(selectedLoanHealth.nextDueRemainingAmount, selectedLoan.currency)}
                        </span>
                      </button>
                    )}

                    {selectedLoanHealth.needsHardshipAssistance && selectedLoanHealth.amountToCatchUp > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setPayAmount(selectedLoanHealth.amountToCatchUp.toFixed(2));
                          setPayNotes(
                            `Regularización total de atraso (${selectedLoanHealth.overdueInstallmentsCount} cuota(s)) · ${selectedLoan.loanNumber}`
                          );
                        }}
                        className="text-left px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition-colors cursor-pointer"
                      >
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-300">
                          Ponerse al día
                        </span>
                        <span className="font-mono tabular-nums text-xs font-bold text-rose-700 dark:text-rose-200">
                          {formatMoney(selectedLoanHealth.amountToCatchUp, selectedLoan.currency)}
                        </span>
                      </button>
                    )}

                    {selectedLoanHealth.estimatedPayoffTotal > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setPayAmount(selectedLoanHealth.estimatedPayoffTotal.toFixed(2));
                          setPayNotes(`Cancelación total estimada · ${selectedLoan.loanNumber}`);
                        }}
                        className="text-left px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#040C1E] hover:bg-emerald-500/10 border border-slate-200 dark:border-white/10 transition-colors cursor-pointer"
                      >
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Saldo estimado
                        </span>
                        <span className="font-mono tabular-nums text-xs font-bold text-emerald-700 dark:text-emerald-300">
                          {formatMoney(selectedLoanHealth.estimatedPayoffTotal, selectedLoan.currency)}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )}

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
                            <div className="flex flex-wrap items-center gap-1.5">
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
                              ) : null}
                              {p.status === 'APLICADO' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const matched = collectionReceipts.find(
                                      (r) => r.paymentId === p.id || (p.receiptNumber && r.receiptNumber === p.receiptNumber)
                                    );
                                    if (matched) {
                                      setPreviewReceipt(matched);
                                      return;
                                    }
                                    const matchedLoan = loans.find(
                                      (l) => l.id === p.loanId || l.loanNumber === p.loanNumber
                                    );
                                    const fallbackReceipt: CollectionReceiptRecord = {
                                      id: `rec_${p.id}`,
                                      organizationId: p.organizationId || organization.id,
                                      receiptNumber: p.receiptNumber || `REC-${p.id.slice(-8).toUpperCase()}`,
                                      paymentId: p.id,
                                      loanId: p.loanId,
                                      loanNumber: p.loanNumber,
                                      customerId: p.customerId,
                                      customerName: p.customerName,
                                      currency: p.currency,
                                      amount: p.amount,
                                      appliedToPrincipal: p.appliedBreakdown?.principal ?? p.amount,
                                      appliedToInterest: p.appliedBreakdown?.interest ?? 0,
                                      appliedToLateFee: p.appliedBreakdown?.lateFee ?? 0,
                                      appliedToCharges: p.appliedBreakdown?.otherCharges ?? 0,
                                      remainingPrincipalAfter: matchedLoan?.currentPrincipalBalance ?? 0,
                                      paymentDate: p.paymentDate,
                                      referenceNumber: p.referenceNumber,
                                      issuedBy: p.appliedByUserId || p.verifiedByUserId || p.reportedByUserId,
                                      issuedByName:
                                        p.appliedByName ||
                                        p.verifiedByName ||
                                        organization.tradeName ||
                                        organization.name,
                                      issuedAt: p.appliedAt || p.paymentDate,
                                      status: 'EMITIDO',
                                      createdAt: p.createdAt,
                                    };
                                    setPreviewReceipt(fallbackReceipt);
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold cursor-pointer"
                                >
                                  <Receipt className="w-3 h-3" />
                                  <span>Recibo</span>
                                </button>
                              )}
                              {!p.receiptEvidenceDataUrl && !isPending && p.status !== 'APLICADO' && (
                                <span className="text-[11px] text-slate-400">—</span>
                              )}
                            </div>
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
        <section className="max-w-4xl mx-auto rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-6 sm:p-8 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#0066FF] dark:text-[#00D1FF]">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Simulador + Precalificación Motor V2</span>
              </div>
              <h2 className="font-display text-lg sm:text-xl font-bold text-slate-950 dark:text-white mt-0.5">
                Solicitud Exprés de Renovación / Reenganche
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Calcula en vivo cuánto efectivo neto recibirías al liquidar tu saldo vigente y envía tu renovación a evaluación prioritaria.
              </p>
            </div>
            {selectedLoanHealth?.isCriticalArrears && (
              <button
                type="button"
                onClick={() => setActiveTab('ALIVIO_FINANCIERO')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs font-semibold cursor-pointer shrink-0"
              >
                <HeartHandshake className="w-4 h-4" />
                <span>¿Atraso alto? Ver Alivio</span>
              </button>
            )}
          </div>

          {/* Live Renewal Simulator Preview */}
          {renewalBaseLoan && renewalSimulation && (
            <div className="rounded-2xl bg-gradient-to-br from-[#040C1E] to-[#0A1E44] border border-[#00B8FF]/30 p-5 text-white space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#00D1FF]">
                  <Calculator className="w-4 h-4" />
                  <span>Simulación Estimada en Tiempo Real · {renewalBaseLoan.loanNumber}</span>
                </div>
                <span className="text-[11px] font-mono text-slate-300">
                  {renewalSimulation.periodCount} cuotas · Tasa ref.{' '}
                  {formatRatePct(renewalSimulation.monthlyRateUsed)}/mes
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl bg-white/[0.06] border border-white/10 p-3.5">
                  <span className="text-[11px] text-slate-300 block">
                    Liquidación Saldo Actual
                  </span>
                  <span className="mt-1 block font-mono tabular-nums text-base font-bold text-slate-100">
                    - {formatMoney(renewalSimulation.estimatedPayoff, renewalBaseLoan.currency)}
                  </span>
                </div>
                <div className="rounded-xl bg-emerald-500/15 border border-emerald-400/30 p-3.5">
                  <span className="text-[11px] text-emerald-200 block">
                    Efectivo Neto Estimado a Recibir
                  </span>
                  <span
                    className={`mt-1 block font-mono tabular-nums text-lg font-bold ${
                      renewalSimulation.coversPayoff ? 'text-emerald-300' : 'text-rose-300'
                    }`}
                  >
                    {renewalSimulation.coversPayoff
                      ? formatMoney(renewalSimulation.estimatedNetDisbursement, renewalBaseLoan.currency)
                      : 'Monto menor al saldo'}
                  </span>
                </div>
                <div className="rounded-xl bg-white/[0.06] border border-white/10 p-3.5">
                  <span className="text-[11px] text-slate-300 block">
                    Cuota Estimada ({renewalFrequency})
                  </span>
                  <span className="mt-1 block font-mono tabular-nums text-base font-bold text-[#00D1FF]">
                    {formatMoney(renewalSimulation.estimatedInstallment, renewalBaseLoan.currency)}
                  </span>
                </div>
              </div>

              {!renewalSimulation.coversPayoff && (
                <p className="text-[11px] text-amber-300">
                  El monto solicitado debe superar el saldo estimado de cancelación (
                  {formatMoney(renewalSimulation.estimatedPayoff, renewalBaseLoan.currency)}) para generar efectivo neto disponible.
                </p>
              )}
            </div>
          )}

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

      {/* TAB 4: GESTIONES Y SOLICITUDES DE SERVICIO */}
      {activeTab === 'GESTIONES_SERVICIO' && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-6 shadow-xs space-y-5">
            <div className="border-b border-slate-200/80 dark:border-white/10 pb-3.5">
              <h2 className="font-display text-base font-bold text-slate-950 dark:text-white">
                Centro de Gestiones y Solicitudes
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                Solicita cartas de saldo, estados de cuenta, acuerdos de prórroga, abonos extraordinarios o actualización de datos directamente a {organization.tradeName || organization.name}.
              </p>
            </div>

            {reqFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  reqFeedback.type === 'ok'
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                    : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-200'
                }`}
              >
                {reqFeedback.type === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{reqFeedback.text}</span>
              </div>
            )}

            <form onSubmit={handleSubmitServiceRequest} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tipo de gestión / solicitud *
                </label>
                <select
                  value={reqType}
                  onChange={(e) => {
                    const nextType = e.target.value as ClientServiceRequestType;
                    setReqType(nextType);
                    setReqSubject('');
                  }}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                >
                  {CLIENT_SERVICE_REQUEST_CATALOG.map((item) => (
                    <option key={item.type} value={item.type}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  {selectedReqCatalog.description}
                </p>
              </div>

              {selectedReqCatalog.requiresLoan && clientLoans.length > 0 && (
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Préstamo relacionado
                  </label>
                  <select
                    value={reqLoanId}
                    onChange={(e) => setReqLoanId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                  >
                    <option value="">Seleccionar préstamo (opcional)</option>
                    {clientLoans.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.loanNumber} · Saldo {formatMoney(l.currentPrincipalBalance, l.currency)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Asunto
                </label>
                <input
                  type="text"
                  value={reqSubject}
                  onChange={(e) => setReqSubject(e.target.value)}
                  placeholder={selectedReqCatalog.label}
                  maxLength={160}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                />
              </div>

              {(reqType === 'ABONO_EXTRAORDINARIO' || reqType === 'ACUERDO_PRORROGA') && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Monto propuesto (opcional)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={reqAmount}
                      onChange={(e) => setReqAmount(e.target.value)}
                      placeholder="Ej. 25000"
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Fecha estimada
                    </label>
                    <input
                      type="date"
                      value={reqDate}
                      onChange={(e) => setReqDate(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>
              )}

              {(reqType === 'VINCULACION_EXPEDIENTE' || reqType === 'ACTUALIZACION_DATOS') && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Cédula / Documento
                    </label>
                    <input
                      type="text"
                      value={reqDocNumber}
                      onChange={(e) => setReqDocNumber(e.target.value)}
                      placeholder="001-0000000-0"
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Teléfono de contacto
                    </label>
                    <input
                      type="text"
                      value={reqPhone}
                      onChange={(e) => setReqPhone(e.target.value)}
                      placeholder="809-555-0100"
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white font-mono"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Detalle de tu solicitud *
                </label>
                <textarea
                  rows={4}
                  required
                  value={reqDetails}
                  onChange={(e) => setReqDetails(e.target.value)}
                  placeholder="Indica los detalles de lo que necesitas (fechas, correo o número de préstamo)..."
                  maxLength={2000}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-[#00B8FF]/20 text-slate-900 dark:text-white"
                />
              </div>

              <button
                type="submit"
                disabled={reqSubmitting}
                className="w-full py-2.5 px-4 rounded-xl axy-brand-gradient hover:brightness-110 text-white font-semibold transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>{reqSubmitting ? 'Enviando gestión...' : 'Enviar Solicitud a la Institución'}</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 p-6 shadow-xs space-y-4">
            <div className="border-b border-slate-200/80 dark:border-white/10 pb-3.5">
              <h2 className="font-display text-base font-bold text-slate-950 dark:text-white">
                Mis Gestiones y Respuestas ({sortedServiceRequests.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Historial en tiempo real de tus trámites y las respuestas emitidas por el equipo oficial.
              </p>
            </div>

            {sortedServiceRequests.length === 0 ? (
              <p className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                Aún no has enviado gestiones. Selecciona un tipo de solicitud a la izquierda para comenzar.
              </p>
            ) : (
              <div className="divide-y divide-slate-200/80 dark:divide-white/10">
                {sortedServiceRequests.map((req) => {
                  const catalogItem = getServiceRequestCatalogItem(req.requestType);
                  const statusColor =
                    req.status === 'COMPLETADA'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : req.status === 'RECHAZADA'
                      ? 'text-rose-600 dark:text-rose-400'
                      : req.status === 'EN_PROCESO'
                      ? 'text-sky-600 dark:text-[#00D1FF]'
                      : 'text-amber-600 dark:text-[#E2B35E]';
                  return (
                    <div key={req.id} className="py-4 space-y-2 text-xs">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <span className="font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">
                            {req.ticketNumber}
                          </span>
                          <span className="mx-2 text-slate-300 dark:text-slate-600">·</span>
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {req.subject || catalogItem.label}
                          </span>
                          {req.loanNumber && (
                            <span className="block text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                              Préstamo: {req.loanNumber}
                            </span>
                          )}
                        </div>
                        <span className={`font-semibold ${statusColor}`}>
                          {CLIENT_SERVICE_REQUEST_STATUS_LABELS[req.status] || req.status}
                        </span>
                      </div>

                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                        {req.details}
                      </p>

                      {req.staffResponse && (
                        <div className="mt-2 p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200/80 dark:border-[#00B8FF]/20 space-y-1">
                          <p className="text-[11px] font-semibold text-[#0052CC] dark:text-[#00D1FF]">
                            Respuesta oficial · {req.resolvedByName || organization.tradeName || organization.name}
                          </p>
                          <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                            {req.staffResponse}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB: AYUDA POR ATRASO / ALIVIO FINANCIERO */}
      {activeTab === 'ALIVIO_FINANCIERO' && userProfile && (
        <ClientHardshipReliefTab
          userProfile={userProfile}
          organization={organization}
          loans={clientLoans}
          selectedLoan={selectedLoan}
          selectedLoanHealth={selectedLoanHealth}
          customer={existingClientCustomer}
          serviceRequests={clientServiceRequests}
          onGoToMessages={() => setActiveTab('MENSAJES_ADMIN')}
        />
      )}

      {/* TAB: MENSAJERÍA DIRECTA CON ADMINISTRADORES */}
      {activeTab === 'MENSAJES_ADMIN' && userProfile && (
        <ClientMessagingCenter
          userProfile={userProfile}
          organization={organization}
          loans={clientLoans}
          selectedLoan={selectedLoan}
          customer={existingClientCustomer}
          messages={clientPortalMessages}
        />
      )}

      <PaymentEvidencePreviewModal
        payment={previewPayment}
        onClose={() => setPreviewPayment(null)}
      />

      <PaymentReceiptModal
        receipt={previewReceipt}
        organization={organization}
        payment={
          previewReceipt
            ? payments.find((p) => p.id === previewReceipt.paymentId) ?? null
            : null
        }
        loan={
          previewReceipt
            ? loans.find(
                (l) => l.id === previewReceipt.loanId || l.loanNumber === previewReceipt.loanNumber
              ) ?? null
            : null
        }
        customer={
          previewReceipt
            ? customers.find((c) => c.id === previewReceipt.customerId) ?? null
            : null
        }
        onClose={() => setPreviewReceipt(null)}
      />
    </div>
  );
}
