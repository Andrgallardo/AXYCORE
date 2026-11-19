import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, FileSignature, Mail, Send } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  buildDefaultFormalizationContent,
  enqueueCustomerStatusEmail,
  generateId,
  recordConfidentialDocumentAccess,
  runBackendAmortization,
  saveFormalizationRecord,
} from '../services/axycoreStore';
import {
  addMonthsPreservingAnchor,
  AmortizationScheduleResult,
  generateAmortizationSchedule,
} from '../engine/amortizationEngine';
import { formatMoney, formatRatePct, normalizeMonthlyRateDecimal, toIsoDateOnly } from '../utils/formatters';

export function FormalizationView() {
  const {
    applications,
    customers,
    committeeDecisions,
    formalizations,
    emailNotifications,
    userProfile,
    selectedApplicationId,
    setSelectedApplicationId,
    setActiveSection,
    rbac,
  } = useAxyCore();

  const canFormalize = rbac.hasPermission('FORMALIZE_LOAN');

  const inbox = useMemo(
    () => applications.filter((a) => ['APROBADA', 'APROBADA_CONDICIONADA'].includes(a.status)),
    [applications]
  );

  const activeApp = useMemo(() => {
    if (selectedApplicationId) {
      const f = inbox.find((a) => a.id === selectedApplicationId);
      if (f) return f;
    }
    return inbox[0] ?? null;
  }, [inbox, selectedApplicationId]);

  const customer = useMemo(
    () => (activeApp ? customers.find((c) => c.id === activeApp.customerId) ?? null : null),
    [activeApp, customers]
  );

  const decision = useMemo(() => {
    if (!activeApp) return null;
    return (
      committeeDecisions.find(
        (d) =>
          d.applicationId === activeApp.id &&
          d.voteStatus === 'RESOLUCION_FINAL' &&
          ['APROBADO', 'APROBADO_CONDICIONADO'].includes(d.decision)
      ) ??
      committeeDecisions.find(
        (d) =>
          d.applicationId === activeApp.id &&
          ['APROBADO', 'APROBADO_CONDICIONADO'].includes(d.decision)
      ) ??
      null
    );
  }, [activeApp, committeeDecisions]);

  const existingForm = useMemo(
    () => (activeApp ? formalizations.find((f) => f.applicationId === activeApp.id) ?? null : null),
    [activeApp, formalizations]
  );

  const approvalEmail = useMemo(() => {
    if (!activeApp) return null;
    const matches = emailNotifications.filter(
      (e) =>
        e.applicationId === activeApp.id &&
        ['APROBADA', 'APROBADA_CONDICIONADA'].includes(e.eventCode)
    );
    return matches[matches.length - 1] ?? null;
  }, [activeApp, emailNotifications]);

  const [allowFinancedExpenses, setAllowFinancedExpenses] = useState(false);
  const [financedExpenses, setFinancedExpenses] = useState(0);
  const [deductedExpenses, setDeductedExpenses] = useState(0);
  const [disbursementTargetDate, setDisbursementTargetDate] = useState(toIsoDateOnly());
  const [firstPaymentDate, setFirstPaymentDate] = useState(
    addMonthsPreservingAnchor(toIsoDateOnly(), 1)
  );
  const [schedule, setSchedule] = useState<AmortizationScheduleResult | null>(null);
  const [contractText, setContractText] = useState('');
  const [promissoryNoteText, setPromissoryNoteText] = useState('');
  const [promissoryNoteConfirmed, setPromissoryNoteConfirmed] = useState(false);
  const [contractConfirmed, setContractConfirmed] = useState(false);
  const [conditionsFulfilled, setConditionsFulfilled] = useState(true);
  const [docsChecklist, setDocsChecklist] = useState([
    { key: 'id_doc', label: 'Documento de identidad vigente', completed: true },
    { key: 'contract_signed', label: 'Contrato de préstamo revisado y correcto', completed: false },
    { key: 'promissory', label: 'Pagaré notarial / mercantil correcto', completed: false },
    { key: 'schedule', label: 'Tabla de amortización generada y enviada al cliente', completed: true },
  ]);
  const [signerName, setSignerName] = useState('');
  const [signMethod, setSignMethod] = useState('PRESENCIAL');
  const [signatures, setSignatures] = useState<
    Array<{ signerName: string; signerRole: string; method: string; signedAt: string }>
  >([]);
  const [saving, setSaving] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
    movedToDisbursement?: boolean;
  } | null>(null);

  const approvedCapital =
    decision?.approvedAmount ?? activeApp?.recommendedAmount ?? activeApp?.requestedAmount ?? 0;
  const contractualRate = normalizeMonthlyRateDecimal(
    decision?.approvedRateMonthly ?? activeApp?.recommendedRateMonthly,
    0.04
  );
  const termMonths =
    decision?.approvedTermMonths ??
    activeApp?.recommendedTermMonths ??
    activeApp?.requestedTermMonths ??
    12;
  const effFinancedExpenses = allowFinancedExpenses ? financedExpenses : 0;
  const totalFinanced = approvedCapital + effFinancedExpenses;
  const netToDeliver = Math.max(0, approvedCapital - deductedExpenses);
  const legalReviewConfirmed = promissoryNoteConfirmed && contractConfirmed;

  useEffect(() => {
    if (!activeApp) return;
    if (existingForm) {
      setFinancedExpenses(existingForm.financedExpenses);
      setAllowFinancedExpenses(existingForm.financedExpenses > 0);
      setDeductedExpenses(existingForm.deductedExpenses);
      setDisbursementTargetDate(existingForm.disbursementTargetDate);
      setFirstPaymentDate(existingForm.firstPaymentDate);
      setContractText(existingForm.contractText);
      setPromissoryNoteText(existingForm.promissoryNoteText);
      setDocsChecklist(existingForm.requiredDocsChecklist);
      const pOk = Boolean(existingForm.promissoryNoteConfirmed ?? existingForm.legalReviewConfirmed);
      const cOk = Boolean(existingForm.contractConfirmed ?? existingForm.legalReviewConfirmed);
      setPromissoryNoteConfirmed(pOk);
      setContractConfirmed(cOk);
      setConditionsFulfilled(existingForm.conditionsFulfilled);
      setSignatures(existingForm.signatures);
    } else {
      const defaults = buildDefaultFormalizationContent({
        application: activeApp,
        customer,
        approvedCapital,
        contractualRate,
        termMonths,
        firstPaymentDate,
      });
      setFinancedExpenses(0);
      setAllowFinancedExpenses(false);
      setDeductedExpenses(0);
      setPromissoryNoteConfirmed(false);
      setContractConfirmed(false);
      setConditionsFulfilled(decision?.decision !== 'APROBADO_CONDICIONADO');
      setSignatures([]);
      setSignerName(
        customer ? `${customer.firstName} ${customer.lastName}` : activeApp.applicantDisplayName
      );
      setContractText(defaults.contractText);
      setPromissoryNoteText(defaults.promissoryNoteText);
    }
  }, [activeApp?.id, existingForm?.id, customer?.id]);

  useEffect(() => {
    if (!activeApp || totalFinanced <= 0) return;
    const params = {
      financedPrincipal: totalFinanced,
      monthlyRate: contractualRate,
      termMonths,
      frequency: activeApp.paymentFrequency,
      amortizationMethod: activeApp.amortizationMethod,
      disbursementDate: disbursementTargetDate,
      firstPaymentDate,
    };
    runBackendAmortization(params)
      .then(setSchedule)
      .catch(() => {
        try {
          setSchedule(generateAmortizationSchedule(params));
        } catch {
          setSchedule(null);
        }
      });
  }, [totalFinanced, contractualRate, termMonths, disbursementTargetDate, firstPaymentDate, activeApp?.id]);

  const handleAddSignature = () => {
    if (!signerName.trim()) return;
    setSignatures((prev) => [
      ...prev,
      {
        signerName: signerName.trim(),
        signerRole: 'Deudor / Solicitante',
        method: signMethod,
        signedAt: new Date().toISOString(),
      },
    ]);
  };

  const handleDownloadDocs = () => {
    if (!activeApp) return;
    const fileName = `Formalizacion_${activeApp.applicationNumber}.txt`;
    if (userProfile) {
      void recordConfidentialDocumentAccess({
        document: {
          id: existingForm?.id ?? `pkg_${activeApp.id}`,
          organizationId: activeApp.organizationId,
          applicationId: activeApp.id,
          category: 'CONTRATO_FIRMADO',
          fileName,
          reviewStatus: existingForm?.status === 'LISTA_PARA_DESEMBOLSO' ? 'VERIFICADO' : 'RECIBIDO',
        },
        accessType: 'DOWNLOAD',
        user: userProfile,
        applicationNumber: activeApp.applicationNumber,
      }).catch(() => {});
    }
    const text =
      `${contractText}\n\n${promissoryNoteText}\n\n` +
      `RESUMEN FINANCIERO:\nCapital Aprobado: ${approvedCapital}\nGastos Financiados: ${effFinancedExpenses}\n` +
      `Total Financiado: ${totalFinanced}\nGastos Descontados: ${deductedExpenses}\nNeto a Entregar: ${netToDeliver}\n` +
      `Total Contractual a Pagar: ${schedule?.totalContractualPayable ?? 0}\n`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleResendConditionsEmail = async () => {
    if (!activeApp || !userProfile) return;
    setResendingEmail(true);
    setFeedback(null);
    try {
      const targetEmailEvent =
        activeApp.status === 'APROBADA_CONDICIONADA' ? 'APROBADA_CONDICIONADA' : 'APROBADA';
      const sent = await enqueueCustomerStatusEmail({
        application: activeApp,
        customer,
        eventCode: targetEmailEvent,
        fromStatus: 'EN_COMITE',
        toStatus: targetEmailEvent,
        historyLength: activeApp.movementHistory?.length ?? 0,
        user: userProfile,
        approvedAmount: approvedCapital,
        approvedRateMonthly: contractualRate,
        approvedTermMonths: termMonths,
        conditions: decision?.conditions?.map((c) => c.text) ?? [],
        amortizationSchedule: schedule?.rows.map((r) => ({
          installmentNumber: r.installmentNumber,
          dueDate: r.dueDate,
          principalAmount: r.principalAmount,
          interestAmount: r.interestAmount,
          totalAmount: r.totalAmount,
          remainingPrincipalBalance: r.remainingPrincipalBalance,
        })),
        paymentFrequency: activeApp.paymentFrequency,
        firstPaymentDate,
        idempotencySuffix: String(Date.now()),
      });
      setFeedback({
        type: 'ok',
        msg:
          sent?.status === 'SKIPPED_NO_EMAIL'
            ? 'El cliente no tiene correo electrónico registrado en su perfil.'
            : `Correo con condiciones y tabla de amortización reenviado a ${sent?.recipientEmail || customer?.email || 'cliente'}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'No fue posible reenviar el correo al cliente.',
      });
    } finally {
      setResendingEmail(false);
    }
  };

  const handleSave = async (ready: boolean) => {
    if (!activeApp || !userProfile) return;
    if (!decision) {
      setFeedback({
        type: 'err',
        msg: 'No se encontró una resolución aprobatoria de Comité para este expediente. Registra primero la resolución en Comité de Crédito.',
      });
      return;
    }
    if (!canFormalize) {
      setFeedback({ type: 'err', msg: 'Solo Formalización o Administrador puede formalizar expedientes.' });
      return;
    }
    if (ready && (!promissoryNoteConfirmed || !contractConfirmed)) {
      setFeedback({
        type: 'err',
        msg: 'Debe confirmar en el checklist que tanto el Pagaré como el Contrato están correctos antes de enviar a Desembolso.',
      });
      return;
    }
    const effectiveSchedule =
      schedule ??
      generateAmortizationSchedule({
        financedPrincipal: totalFinanced,
        monthlyRate: contractualRate,
        termMonths,
        frequency: activeApp.paymentFrequency,
        amortizationMethod: activeApp.amortizationMethod,
        disbursementDate: disbursementTargetDate,
        firstPaymentDate,
      });
    setSaving(true);
    setFeedback(null);
    try {
      await saveFormalizationRecord({
        application: activeApp,
        markReadyForDisbursement: ready,
        user: userProfile,
        formalization: {
          id: existingForm?.id ?? `form_${activeApp.id}`,
          organizationId: activeApp.organizationId,
          applicationId: activeApp.id,
          decisionId: decision.id,
          approvedCapital,
          financedExpenses: effFinancedExpenses,
          totalFinanced,
          deductedExpenses,
          netDisbursementAmount: netToDeliver,
          contractualRateMonthly: contractualRate,
          termMonths,
          frequency: activeApp.paymentFrequency,
          amortizationMethod: activeApp.amortizationMethod,
          disbursementTargetDate,
          firstPaymentDate,
          maturityDate: effectiveSchedule.maturityDate,
          totalContractualPayable: effectiveSchedule.totalContractualPayable,
          contractTemplateVersion: 'tpl-v1.0-revision-legal',
          contractText,
          promissoryNoteText,
          requiredDocsChecklist: docsChecklist,
          conditionsFulfilled,
          signatures,
          collateralDetails: activeApp.proposedCollateral ?? '',
          legalReviewConfirmed,
          promissoryNoteConfirmed,
          contractConfirmed,
          status: ready ? 'LISTA_PARA_DESEMBOLSO' : 'PENDIENTE',
          formalizedBy: userProfile.uid,
          formalizedByName: userProfile.displayName,
        },
      });
      setFeedback({
        type: 'ok',
        movedToDisbursement: ready,
        msg: ready
          ? `Expediente ${activeApp.applicationNumber} formalizado y enviado a Desembolso.`
          : 'Borrador de formalización guardado.',
      });
    } catch (err) {
      setFeedback({ type: 'err', msg: err instanceof Error ? err.message : 'Error guardando formalización.' });
    } finally {
      setSaving(false);
    }
  };

  if (inbox.length === 0) {
    return (
      <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3">
        <p className="text-sm text-slate-500">No hay solicitudes aprobadas pendientes de formalización.</p>
        <button
          type="button"
          onClick={() => setActiveSection('committee')}
          className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-sky-600 text-white text-xs font-medium cursor-pointer"
        >
          Ir a Comité de Crédito
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-4 space-y-2">
        <h2 className="font-display text-base font-bold">Pendientes de Formalización ({inbox.length})</h2>
        {inbox.map((app) => (
          <button
            key={app.id}
            type="button"
            onClick={() => setSelectedApplicationId(app.id)}
            className={`w-full text-left p-4 rounded-xl border cursor-pointer ${
              activeApp?.id === app.id
                ? 'border-sky-700 bg-sky-50/70 dark:bg-sky-950/40'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
            }`}
          >
            <p className="font-mono text-xs text-slate-500">{app.applicationNumber}</p>
            <p className="font-semibold text-sm mt-1">{app.applicantDisplayName}</p>
            <p className="text-xs text-slate-500">{app.status}</p>
          </button>
        ))}
      </div>

      {activeApp && (
        <div className="lg:col-span-8 space-y-5 text-xs">
          {feedback && (
            <div
              className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${
                feedback.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              <span>{feedback.msg}</span>
              {feedback.movedToDisbursement && (
                <button
                  type="button"
                  onClick={() => setActiveSection('disbursements')}
                  className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                >
                  Ir a Desembolso
                </button>
              )}
            </div>
          )}

          {/* Auto-generated Pagaré, Contrato y Correo */}
          <div className="p-4 rounded-2xl bg-[#040C1E] text-white border border-[#00B8FF]/25 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="font-bold text-sm flex items-center gap-2 text-[#00D1FF]">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Pagaré y Contrato Generados Automáticamente
              </p>
              <p className="text-[11px] text-slate-300">
                Estado del correo de condiciones y tabla de amortización:{' '}
                <strong className="text-white">
                  {approvalEmail
                    ? `${approvalEmail.status} (${approvalEmail.recipientEmail || 'sin correo'})`
                    : customer?.email
                    ? `Listo para ${customer.email}`
                    : 'Cliente sin correo registrado'}
                </strong>
              </p>
            </div>
            <button
              type="button"
              disabled={resendingEmail}
              onClick={handleResendConditionsEmail}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0066FF] hover:bg-[#0052CC] text-white font-semibold cursor-pointer disabled:opacity-50"
            >
              <Mail className="w-3.5 h-3.5" />
              {resendingEmail ? 'Enviando...' : 'Reenviar Correo al Cliente'}
            </button>
          </div>

          {/* Breakdown: Capital vs Financed vs Deducted vs Net */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold flex items-center gap-2">
                <FileSignature className="w-4 h-4 text-sky-600" />
                Desglose Contractual y Gastos
              </h3>
              <button
                type="button"
                onClick={handleDownloadDocs}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-medium cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Descargar Paquete
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <p className="text-slate-500">Capital Aprobado</p>
                <p className="font-mono font-bold text-sm mt-0.5">{formatMoney(approvedCapital, activeApp.currency)}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <p className="text-slate-500">Gastos Financiados</p>
                <p className="font-mono font-bold text-sm mt-0.5">{formatMoney(effFinancedExpenses, activeApp.currency)}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <p className="text-slate-500">Total Financiado</p>
                <p className="font-mono font-bold text-sm mt-0.5">{formatMoney(totalFinanced, activeApp.currency)}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <p className="text-slate-500">Gastos Descontados</p>
                <p className="font-mono font-bold text-sm mt-0.5">{formatMoney(deductedExpenses, activeApp.currency)}</p>
              </div>
              <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-950/40">
                <p className="text-sky-700 dark:text-sky-300">Neto a Entregar</p>
                <p className="font-mono font-bold text-sm mt-0.5">{formatMoney(netToDeliver, activeApp.currency)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
              <div>
                <label className="inline-flex items-center gap-1.5 mb-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowFinancedExpenses}
                    onChange={(e) => setAllowFinancedExpenses(e.target.checked)}
                  />
                  <span>Autorizar gastos financiados</span>
                </label>
                <input
                  type="number"
                  min={0}
                  disabled={!allowFinancedExpenses}
                  value={financedExpenses}
                  onChange={(e) => setFinancedExpenses(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500">Gastos Descontados</label>
                <input
                  type="number"
                  min={0}
                  value={deductedExpenses}
                  onChange={(e) => setDeductedExpenses(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500">Fecha Desembolso Est.</label>
                <input
                  type="date"
                  value={disbursementTargetDate}
                  onChange={(e) => setDisbursementTargetDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500">Fecha Primera Cuota</label>
                <input
                  type="date"
                  value={firstPaymentDate}
                  onChange={(e) => setFirstPaymentDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>
          </div>

          {/* Contract & Promissory Note Templates */}
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <h4 className="font-semibold text-sm">Pagaré y Contrato de Préstamo</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block mb-1 text-slate-500">Contrato de Préstamo</label>
                <textarea
                  rows={6}
                  value={contractText}
                  onChange={(e) => setContractText(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block mb-1 text-slate-500">Pagaré</label>
                <textarea
                  rows={6}
                  value={promissoryNoteText}
                  onChange={(e) => setPromissoryNoteText(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              {docsChecklist.map((item, idx) => (
                <label key={item.key} className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={(e) =>
                      setDocsChecklist((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, completed: e.target.checked } : x))
                      )
                    }
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>

            {/* Checklist obligatorio de Pagaré y Contrato correctos */}
            <div className="p-3.5 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 space-y-2.5">
              <p className="font-semibold text-slate-900 dark:text-white">
                Checklist de Validación Contractual (Obligatorio para Enviar a Desembolso)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={promissoryNoteConfirmed}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setPromissoryNoteConfirmed(next);
                      setDocsChecklist((prev) =>
                        prev.map((d) => (d.key === 'promissory' ? { ...d, completed: next } : d))
                      );
                    }}
                  />
                  <span>Confirmo que el Pagaré está correcto</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={contractConfirmed}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setContractConfirmed(next);
                      setDocsChecklist((prev) =>
                        prev.map((d) => (d.key === 'contract_signed' ? { ...d, completed: next } : d))
                      );
                    }}
                  />
                  <span>Confirmo que el Contrato está correcto</span>
                </label>
              </div>
              {decision?.decision === 'APROBADO_CONDICIONADO' && (
                <label className="block cursor-pointer font-medium text-amber-700 dark:text-amber-400 pt-1">
                  <input
                    type="checkbox"
                    checked={conditionsFulfilled}
                    onChange={(e) => setConditionsFulfilled(e.target.checked)}
                    className="mr-2"
                  />
                  Confirmo el cumplimiento íntegro de las condiciones establecidas por el Comité
                </label>
              )}
            </div>

            {/* Signature Evidence */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <p className="font-semibold">Evidencias de Firma ({signatures.length})</p>
              <div className="flex flex-wrap gap-2">
                <input
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Nombre del firmante"
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
                <select
                  value={signMethod}
                  onChange={(e) => setSignMethod(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                >
                  <option value="PRESENCIAL">Firma Presencial Verificada</option>
                  <option value="ELECTRONICA_CERTIFICADA">Firma Electrónica Configurada</option>
                </select>
                <button
                  type="button"
                  onClick={handleAddSignature}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 font-medium cursor-pointer"
                >
                  Registrar Firma
                </button>
              </div>
              {signatures.map((s, idx) => (
                <p key={idx} className="font-mono text-slate-600 dark:text-slate-300">
                  • {s.signerName} ({s.method}) — {s.signedAt}
                </p>
              ))}
            </div>
          </div>

          {/* Amortization Preview */}
          {schedule && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex justify-between items-center">
                <h4 className="font-semibold text-sm">
                  Tabla de Amortización Contractual ({schedule.rows.length} cuotas · Conciliación:{' '}
                  {schedule.isReconciled ? 'Exacta' : 'Revisar'})
                </h4>
                <span className="font-mono font-bold">
                  Total Contractual: {formatMoney(schedule.totalContractualPayable, activeApp.currency)}
                </span>
              </div>
              <div className="max-h-60 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs font-mono tabular-nums">
                  <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Cuota</th>
                      <th className="py-2 px-3">Fecha</th>
                      <th className="py-2 px-3 text-right">Capital</th>
                      <th className="py-2 px-3 text-right">Interés</th>
                      <th className="py-2 px-3 text-right">Total</th>
                      <th className="py-2 px-3 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {schedule.rows.map((r) => (
                      <tr key={r.installmentNumber}>
                        <td className="py-1.5 px-3">{r.installmentNumber}</td>
                        <td className="py-1.5 px-3">{r.dueDate}</td>
                        <td className="py-1.5 px-3 text-right">{r.principalAmount.toFixed(2)}</td>
                        <td className="py-1.5 px-3 text-right">{r.interestAmount.toFixed(2)}</td>
                        <td className="py-1.5 px-3 text-right font-semibold">{r.totalAmount.toFixed(2)}</td>
                        <td className="py-1.5 px-3 text-right">{r.remainingPrincipalBalance.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              disabled={saving || !canFormalize}
              onClick={() => handleSave(false)}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 font-medium cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              Guardar Borrador
            </button>
            <button
              type="button"
              disabled={saving || !canFormalize || !promissoryNoteConfirmed || !contractConfirmed}
              onClick={() => handleSave(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              {saving ? 'Procesando...' : 'Enviar a Desembolso'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

