import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  FilePlus2,
  Plus,
  Save,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useAxyCore } from '../../../context/AxyCoreContext';
import {
  computeEcfLineItemsAndTotals,
  formatEncf,
  validateEcfBeforeIssuance,
  validateTaxIdByType,
  type DraftLineInput,
} from '../../../engine/dgii/dgiiCatalogAndValidation';
import { buildDgiiEcfXml } from '../../../engine/dgii/dgiiXmlEngine';
import { validateEcfBeforeDigitalSignature } from '../../../engine/dgii/xmlValidator';
import { generateId } from '../../../services/axycoreStore';
import { issueAndProcessEcfDocument, saveEcfDraftDocument } from '../../../services/dgiiEcfStore';
import {
  ALL_ECF_TYPES,
  ECF_TYPE_META,
  type DgiiEcfDocumentRecord,
  type EcfItbisRate,
  type EcfModificationCode,
  type EcfPaymentCondition,
  type EcfPaymentMethodCode,
  type EcfTypeCode,
  type OtherTaxCode,
} from '../../../types/dgiiEcf';
import type { CurrencyCode } from '../../../types/axycore';
import { formatMoney } from '../../../utils/formatters';

export interface EcfAdjustmentPrefill {
  targetType: '33' | '34';
  referenceDoc: DgiiEcfDocumentRecord;
}

const DEFAULT_LINE: DraftLineInput = {
  description: '',
  itemType: 'SERVICIO',
  quantity: 1,
  unitOfMeasure: 'UND',
  unitPrice: 0,
  discountAmount: 0,
  itbisRate: 18,
  isExempt: false,
  otherTaxCode: 'NINGUNO',
  otherTaxRatePct: 0,
};

export function DgiiEmitInvoiceView({
  initialPrefill,
  onClearPrefill,
}: {
  initialPrefill?: EcfAdjustmentPrefill | null;
  onClearPrefill?: () => void;
}) {
  const {
    organization,
    userProfile,
    rbac,
    activeDgiiConfig,
    dgiiSequences,
    dgiiCertificates,
    dgiiReceivers,
    dgiiProducts,
    dgiiEcfDocuments,
    accountingAccounts,
    setActiveSection,
  } = useAxyCore();

  const canEmit = rbac.hasPermission('EMIT_ECF');

  const activeCert = useMemo(
    () => dgiiCertificates.find((c) => c.status === 'ACTIVO' || c.status === 'POR_VENCER') ?? null,
    [dgiiCertificates]
  );

  const drafts = useMemo(
    () => dgiiEcfDocuments.filter((d) => d.direction === 'EMITIDO' && d.status === 'BORRADOR'),
    [dgiiEcfDocuments]
  );

  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [ecfType, setEcfType] = useState<EcfTypeCode>(activeDgiiConfig.enabledEcfTypes[0] || '31');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [paymentCondition, setPaymentCondition] = useState<EcfPaymentCondition>('CONTADO');
  const [paymentMethod, setPaymentMethod] = useState<EcfPaymentMethodCode>('CHEQUE_TRANSFERENCIA');
  const [currency, setCurrency] = useState<CurrencyCode>(activeDgiiConfig.defaultCurrency || 'DOP');
  const [exchangeRate, setExchangeRate] = useState(1);

  const [selectedReceiverId, setSelectedReceiverId] = useState('');
  const [receiverIdType, setReceiverIdType] = useState<'RNC' | 'CEDULA' | 'PASAPORTE' | 'SIN_ID'>('RNC');
  const [receiverTaxId, setReceiverTaxId] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverAddress, setReceiverAddress] = useState('');
  const [receiverEmail, setReceiverEmail] = useState('');

  const [referenceEcf, setReferenceEcf] = useState('');
  const [referenceDate, setReferenceDate] = useState('');
  const [modificationCode, setModificationCode] = useState<EcfModificationCode>('3');
  const [notes, setNotes] = useState('');
  const [submitToDgiiAfterSign, setSubmitToDgiiAfterSign] = useState(true);

  const [lines, setLines] = useState<DraftLineInput[]>([{ ...DEFAULT_LINE }]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!initialPrefill) return;
    const ref = initialPrefill.referenceDoc;
    setEditingDraftId(null);
    setEcfType(initialPrefill.targetType);
    setReceiverIdType(ref.receiverIdType);
    setReceiverTaxId(ref.receiverTaxId);
    setReceiverName(ref.receiverName);
    setReceiverAddress(ref.receiverAddress);
    setReceiverEmail(ref.receiverEmail || '');
    setCurrency(ref.currency);
    setExchangeRate(ref.exchangeRate || 1);
    setReferenceEcf(ref.eNCF);
    setReferenceDate(ref.issueDate);
    setModificationCode(initialPrefill.targetType === '34' ? '1' : '3');
    setLines(
      ref.items.map((it) => ({
        productId: it.productId,
        sku: it.sku,
        description: it.description,
        itemType: it.itemType,
        quantity: it.quantity,
        unitOfMeasure: it.unitOfMeasure,
        unitPrice: it.unitPrice,
        discountAmount: it.discountAmount,
        itbisRate: it.itbisRate,
        isExempt: it.isExempt,
        otherTaxCode: it.otherTaxCode,
        otherTaxRatePct: it.otherTaxRatePct,
        accountCode: it.accountCode,
      }))
    );
    onClearPrefill?.();
  }, [initialPrefill, onClearPrefill]);

  const handleSelectReceiver = (id: string) => {
    setSelectedReceiverId(id);
    const rec = dgiiReceivers.find((r) => r.id === id);
    if (!rec) return;
    setReceiverIdType(rec.idType);
    setReceiverTaxId(rec.taxId);
    setReceiverName(rec.legalName);
    setReceiverAddress(rec.address);
    setReceiverEmail(rec.email);
  };

  const handleLoadDraft = (draft: DgiiEcfDocumentRecord) => {
    setEditingDraftId(draft.id);
    setEcfType(draft.ecfType);
    setIssueDate(draft.issueDate);
    setDueDate(draft.dueDate || '');
    setPaymentCondition(draft.paymentCondition);
    setPaymentMethod(draft.paymentMethod);
    setCurrency(draft.currency);
    setExchangeRate(draft.exchangeRate || 1);
    setSelectedReceiverId(draft.receiverId || '');
    setReceiverIdType(draft.receiverIdType);
    setReceiverTaxId(draft.receiverTaxId);
    setReceiverName(draft.receiverName);
    setReceiverAddress(draft.receiverAddress);
    setReceiverEmail(draft.receiverEmail || '');
    setReferenceEcf(draft.referenceEcf || '');
    setReferenceDate(draft.referenceDate || '');
    setModificationCode(draft.modificationCode || '3');
    setNotes(draft.notes || '');
    setLines(
      draft.items.map((it) => ({
        productId: it.productId,
        sku: it.sku,
        description: it.description,
        itemType: it.itemType,
        quantity: it.quantity,
        unitOfMeasure: it.unitOfMeasure,
        unitPrice: it.unitPrice,
        discountAmount: it.discountAmount,
        itbisRate: it.itbisRate,
        isExempt: it.isExempt,
        otherTaxCode: it.otherTaxCode,
        otherTaxRatePct: it.otherTaxRatePct,
        accountCode: it.accountCode,
      }))
    );
  };

  const handlePickProductForLine = (idx: number, productId: string) => {
    const prod = dgiiProducts.find((p) => p.id === productId);
    if (!prod) return;
    setLines((prev) =>
      prev.map((l, i) =>
        i === idx
          ? {
              ...l,
              productId: prod.id,
              sku: prod.sku,
              description: prod.name,
              itemType: prod.itemType,
              unitOfMeasure: prod.unitOfMeasure,
              unitPrice: prod.unitPrice,
              itbisRate: prod.itbisRate,
              isExempt: prod.isExempt,
              otherTaxCode: prod.otherTaxCode,
              otherTaxRatePct: prod.otherTaxRatePct,
              accountCode: prod.incomeAccountCode,
            }
          : l
      )
    );
  };

  const computed = useMemo(() => computeEcfLineItemsAndTotals(lines, ecfType), [lines, ecfType]);

  const taxIdValidation = useMemo(
    () => validateTaxIdByType(receiverIdType, receiverTaxId),
    [receiverIdType, receiverTaxId]
  );

  const preValidation = useMemo(
    () =>
      validateEcfBeforeIssuance({
        config: activeDgiiConfig,
        ecfType,
        issueDate,
        receiverIdType,
        receiverTaxId,
        receiverName,
        items: computed.items,
        totalAmount: computed.totalAmount,
        currency,
        referenceEcf,
        referenceDate,
        modificationCode,
        sequences: dgiiSequences,
        isDraftOnly: false,
      }),
    [
      activeDgiiConfig,
      ecfType,
      issueDate,
      receiverIdType,
      receiverTaxId,
      receiverName,
      computed,
      currency,
      referenceEcf,
      referenceDate,
      modificationCode,
      dgiiSequences,
    ]
  );

  const liveXsdCheck = useMemo(() => {
    const previewDoc: DgiiEcfDocumentRecord = {
      id: editingDraftId || 'preview_xsd',
      organizationId: organization.id,
      direction: 'EMITIDO',
      ecfType,
      eNCF: formatEncf(ecfType, 1),
      status: 'BORRADOR',
      environment: activeDgiiConfig.environment,
      isOfficialDgiiResponse: false,
      isTestSimulation: activeDgiiConfig.environment === 'DESARROLLO',
      issuerRnc: activeDgiiConfig.rnc || organization.rnc || '101000007',
      issuerName: activeDgiiConfig.legalName || organization.legalName || organization.name,
      issuerAddress: activeDgiiConfig.fiscalAddress || organization.address || 'República Dominicana',
      receiverIdType,
      receiverTaxId,
      receiverName: receiverName || (ecfType === '32' ? 'CONSUMIDOR FINAL' : 'RECEPTOR'),
      receiverAddress: receiverAddress || 'República Dominicana',
      receiverEmail: receiverEmail || undefined,
      issueDate,
      dueDate: dueDate || undefined,
      paymentCondition,
      paymentMethod,
      currency,
      exchangeRate,
      items: computed.items,
      subtotal: computed.subtotal,
      totalDiscount: computed.totalDiscount,
      exemptAmount: computed.exemptAmount,
      taxableAmount18: computed.taxableAmount18,
      taxableAmount16: computed.taxableAmount16,
      totalItbis: computed.totalItbis,
      otherTaxesTotal: computed.otherTaxesTotal,
      totalAmount: computed.totalAmount,
      referenceEcf: referenceEcf || undefined,
      referenceDate: referenceDate || undefined,
      modificationCode: ecfType === '33' || ecfType === '34' ? modificationCode : undefined,
      dgiiResponses: [],
      commercialApprovalStatus: 'NO_APLICA',
      paymentCollectionStatus: 'NO_APLICA',
      createdBy: userProfile?.uid || 'system',
      createdByName: userProfile?.displayName || 'Sistema',
    };
    const previewXml = buildDgiiEcfXml({ document: previewDoc, config: activeDgiiConfig });
    return validateEcfBeforeDigitalSignature(previewXml, ecfType);
  }, [
    editingDraftId,
    organization,
    ecfType,
    activeDgiiConfig,
    receiverIdType,
    receiverTaxId,
    receiverName,
    receiverAddress,
    receiverEmail,
    issueDate,
    dueDate,
    paymentCondition,
    paymentMethod,
    currency,
    exchangeRate,
    computed,
    referenceEcf,
    referenceDate,
    modificationCode,
    userProfile,
  ]);

  const buildDocumentPayload = (): Omit<DgiiEcfDocumentRecord, 'createdAt' | 'updatedAt'> => ({
    id: editingDraftId || generateId('ecf'),
    organizationId: organization.id,
    direction: 'EMITIDO',
    ecfType,
    eNCF: '',
    status: 'BORRADOR',
    environment: activeDgiiConfig.environment,
    isOfficialDgiiResponse: false,
    isTestSimulation: activeDgiiConfig.environment === 'DESARROLLO',
    issuerRnc: activeDgiiConfig.rnc,
    issuerName: activeDgiiConfig.legalName,
    issuerAddress: activeDgiiConfig.fiscalAddress,
    receiverId: selectedReceiverId || undefined,
    receiverIdType,
    receiverTaxId: taxIdValidation.normalized || receiverTaxId.trim(),
    receiverName: receiverName.trim() || (ecfType === '32' ? 'CONSUMIDOR FINAL' : ''),
    receiverAddress: receiverAddress.trim() || 'República Dominicana',
    receiverEmail: receiverEmail.trim() || undefined,
    issueDate,
    dueDate: dueDate || undefined,
    paymentCondition,
    paymentMethod,
    currency,
    exchangeRate: currency === 'DOP' ? 1 : Math.max(0.01, Number(exchangeRate) || 1),
    items: computed.items,
    subtotal: computed.subtotal,
    totalDiscount: computed.totalDiscount,
    exemptAmount: computed.exemptAmount,
    taxableAmount18: computed.taxableAmount18,
    taxableAmount16: computed.taxableAmount16,
    totalItbis: computed.totalItbis,
    otherTaxesTotal: computed.otherTaxesTotal,
    totalAmount: computed.totalAmount,
    referenceEcf: ecfType === '33' || ecfType === '34' ? referenceEcf.trim().toUpperCase() : undefined,
    referenceDate: ecfType === '33' || ecfType === '34' ? referenceDate : undefined,
    modificationCode: ecfType === '33' || ecfType === '34' ? modificationCode : undefined,
    notes: notes.trim() || undefined,
    dgiiResponses: [],
    commercialApprovalStatus: 'NO_APLICA',
    paymentCollectionStatus: paymentCondition === 'CONTADO' ? 'NO_APLICA' : 'PENDIENTE',
    createdBy: userProfile?.uid || 'system',
    createdByName: userProfile?.displayName || 'Usuario',
  });

  const handleSaveDraft = async () => {
    if (!canEmit) return;
    setBusy(true);
    setFeedback(null);
    try {
      const saved = await saveEcfDraftDocument({ document: buildDocumentPayload() });
      setEditingDraftId(saved.id);
      setFeedback({
        kind: 'ok',
        text: 'Borrador guardado exitosamente sin consumir secuencia e-NCF.',
      });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Error guardando borrador e-CF.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleIssueDocument = async () => {
    if (!canEmit || !userProfile) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await issueAndProcessEcfDocument({
        draft: buildDocumentPayload(),
        config: activeDgiiConfig,
        sequences: dgiiSequences,
        activeCertificate: activeCert,
        accounts: accountingAccounts,
        user: userProfile,
        submitToDgiiAfterSign,
      });
      setEditingDraftId(null);
      setLines([{ ...DEFAULT_LINE }]);
      setNotes('');
      setFeedback({
        kind: 'ok',
        text: `Comprobante ${result.document.eNCF} emitido (${result.document.status})${
          result.journalEntry ? ` · Asiento contable ${result.journalEntry.entryNumber} contabilizado` : ''
        }.`,
      });
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Error emitiendo comprobante electrónico.',
      });
    } finally {
      setBusy(false);
    }
  };

  const isTypeEnabled = activeDgiiConfig.enabledEcfTypes.includes(ecfType);

  return (
    <div className="space-y-6 text-xs">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
            <FilePlus2 className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
            <span>Emitir Factura / Comprobante Electrónico DGII (e-CF)</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            Generación XML conforme XSD Ley 32-23, validación tributaria, asignación atómica de e-NCF, firma XMLDSig y
            contabilización automática.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {drafts.length > 0 && (
            <select
              value={editingDraftId || ''}
              onChange={(e) => {
                const found = drafts.find((d) => d.id === e.target.value);
                if (found) handleLoadDraft(found);
              }}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#08132B]"
            >
              <option value="">Retomar Borrador ({drafts.length})...</option>
              {drafts.map((d) => (
                <option key={d.id} value={d.id}>
                  E{d.ecfType} · {d.receiverName || 'Sin receptor'} · {formatMoney(d.totalAmount, d.currency)}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setActiveSection('ecf_issued')}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 font-semibold cursor-pointer"
          >
            Ver Emitidas
          </button>
        </div>
      </div>

      {/* Security / Environment / Certificate Banner */}
      {activeDgiiConfig.environment === 'PRODUCCION' && !activeDgiiConfig.isCertifiedByDgii && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-300 dark:border-rose-500/30 text-rose-800 dark:text-rose-200 flex items-center gap-2.5">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            <strong>Producción Bloqueada:</strong> La empresa no ha completado la certificación oficial DGII. Cambie a
            PRECERTIFICACION/CERTIFICACION o complete la certificación en Configuración DGII.
          </span>
        </div>
      )}

      {!activeCert && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              No hay certificado digital (.p12) activo cargado. El comprobante quedará en estado PENDIENTE_FIRMA sin envío a
              DGII hasta cargar un certificado.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveSection('ecf_certificates')}
            className="px-3 py-1 rounded-lg bg-amber-600 text-white font-semibold cursor-pointer shrink-0"
          >
            Ir a Certificados
          </button>
        </div>
      )}

      {feedback && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
            feedback.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="font-bold cursor-pointer">
            ×
          </button>
        </div>
      )}

      {/* Issuer & Type Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#00B8FF]">
            Emisor Fiscal ({activeDgiiConfig.environment})
          </p>
          <p className="font-semibold text-sm text-slate-950 dark:text-white">{activeDgiiConfig.legalName}</p>
          <p className="font-mono text-slate-600 dark:text-slate-300">RNC: {activeDgiiConfig.rnc || 'No configurado'}</p>
          <p className="text-slate-500 dark:text-slate-400">{activeDgiiConfig.fiscalAddress || 'Dirección no configurada'}</p>
          <div className="pt-2 border-t border-slate-100 dark:border-white/5 flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Próximo e-NCF proyectado:</span>
            <span className="font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">
              {preValidation.projectedEncf || 'Sin rango activo'}
            </span>
          </div>
        </div>

        <div className="lg:col-span-2 p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold mb-1 text-slate-600 dark:text-slate-300">
              Tipo de Comprobante Electrónico (e-CF)
            </label>
            <select
              value={ecfType}
              onChange={(e) => setEcfType(e.target.value as EcfTypeCode)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
            >
              {ALL_ECF_TYPES.map((code) => {
                const enabled = activeDgiiConfig.enabledEcfTypes.includes(code);
                return (
                  <option key={code} value={code}>
                    {code} · {ECF_TYPE_META[code].name} {!enabled ? ' (No habilitado)' : ''}
                  </option>
                );
              })}
            </select>
            {!isTypeEnabled && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                La empresa no tiene derecho habilitado para emitir tipo e-CF {ecfType}. Actívelo en Configuración DGII.
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold mb-1 text-slate-600 dark:text-slate-300">
              Fecha de Emisión
            </label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold mb-1 text-slate-600 dark:text-slate-300">
              Condición de Pago
            </label>
            <select
              value={paymentCondition}
              onChange={(e) => setPaymentCondition(e.target.value as EcfPaymentCondition)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
            >
              <option value="CONTADO">Contado</option>
              <option value="CREDITO_15">Crédito 15 días</option>
              <option value="CREDITO_30">Crédito 30 días</option>
              <option value="CREDITO_60">Crédito 60 días</option>
              <option value="OTRO">Otra condición</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold mb-1 text-slate-600 dark:text-slate-300">
              Forma de Pago
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as EcfPaymentMethodCode)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
            >
              <option value="EFECTIVO">01 · Efectivo</option>
              <option value="CHEQUE_TRANSFERENCIA">02 · Cheque / Transferencia</option>
              <option value="TARJETA_CREDITO_DEBITO">03 · Tarjeta Crédito / Débito</option>
              <option value="VENTA_CREDITO">04 · Venta a Crédito</option>
              <option value="BONOS_CERTIFICADOS">05 · Bonos o Certificados</option>
              <option value="PERMUTA">06 · Permuta</option>
              <option value="NOTA_CREDITO">07 · Nota de Crédito</option>
              <option value="OTRAS">08 · Otras formas de pago</option>
            </select>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[11px] font-semibold mb-1 text-slate-600 dark:text-slate-300">Moneda</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
              >
                <option value="DOP">DOP</option>
                <option value="USD">USD</option>
              </select>
            </div>
            {currency === 'USD' && (
              <div className="w-24">
                <label className="block text-[11px] font-semibold mb-1 text-slate-600 dark:text-slate-300">Tasa</label>
                <input
                  type="number"
                  step="0.01"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(Number(e.target.value))}
                  className="w-full px-2 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reference NCF Block for Notes 33 & 34 */}
      {(ecfType === '33' || ecfType === '34') && (
        <div className="p-4 rounded-2xl bg-sky-50/60 dark:bg-[#00B8FF]/5 border border-sky-200 dark:border-[#00B8FF]/25 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-semibold mb-1">e-NCF Modificado (Obligatorio)</label>
            <input
              type="text"
              value={referenceEcf}
              onChange={(e) => setReferenceEcf(e.target.value.toUpperCase())}
              placeholder="Ej. E310000000001"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#040C1E] font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold mb-1">Fecha e-NCF Modificado</label>
            <input
              type="date"
              value={referenceDate}
              onChange={(e) => setReferenceDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#040C1E] font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold mb-1">Código Modificación DGII</label>
            <select
              value={modificationCode}
              onChange={(e) => setModificationCode(e.target.value as EcfModificationCode)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#040C1E]"
            >
              <option value="1">1 · Anula el NCF modificado</option>
              <option value="2">2 · Corrige Texto del Comprobante</option>
              <option value="3">3 · Corrige Montos del NCF</option>
              <option value="4">4 · Reemplazo NCF en contingencia</option>
              <option value="5">5 · Referencia Factura de Consumo</option>
            </select>
          </div>
        </div>
      )}

      {/* Receiver Data */}
      <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-950 dark:text-white">Datos del Cliente / Receptor</h3>
          <select
            value={selectedReceiverId}
            onChange={(e) => handleSelectReceiver(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
          >
            <option value="">Seleccionar de Clientes y Receptores...</option>
            {dgiiReceivers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.legalName} ({r.taxId})
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-semibold mb-1">Tipo ID</label>
            <select
              value={receiverIdType}
              onChange={(e) => setReceiverIdType(e.target.value as typeof receiverIdType)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
            >
              <option value="RNC">RNC</option>
              <option value="CEDULA">Cédula</option>
              <option value="PASAPORTE">Pasaporte</option>
              <option value="SIN_ID">Sin ID (Consumo &lt; 250k)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold mb-1">RNC / Cédula Receptor</label>
            <input
              type="text"
              value={receiverTaxId}
              disabled={receiverIdType === 'SIN_ID'}
              onChange={(e) => setReceiverTaxId(e.target.value)}
              placeholder="Ej. 101010101"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono disabled:opacity-50"
            />
            {receiverIdType !== 'SIN_ID' && receiverTaxId.trim().length > 0 && (
              <p
                className={`mt-0.5 text-[10px] ${
                  taxIdValidation.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {taxIdValidation.valid ? 'Dígito verificador válido' : taxIdValidation.reason}
              </p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold mb-1">Razón Social / Nombre Completo</label>
            <input
              type="text"
              value={receiverName}
              onChange={(e) => setReceiverName(e.target.value)}
              placeholder="Nombre o Razón Social del receptor"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold mb-1">Dirección del Receptor</label>
            <input
              type="text"
              value={receiverAddress}
              onChange={(e) => setReceiverAddress(e.target.value)}
              placeholder="Dirección fiscal o comercial"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold mb-1">Correo del Receptor</label>
            <input
              type="email"
              value={receiverEmail}
              onChange={(e) => setReceiverEmail(e.target.value)}
              placeholder="cliente@empresa.do"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold mb-1">Fecha Límite Pago (opcional)</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
            />
          </div>
        </div>
      </div>

      {/* Line Items Builder */}
      <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-950 dark:text-white">Detalle de Productos y Servicios</h3>
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, { ...DEFAULT_LINE }])}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Agregar Línea</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-[#040C1E] text-[10px] uppercase text-slate-500">
                <th className="py-2 px-2">Catálogo</th>
                <th className="py-2 px-2">Descripción</th>
                <th className="py-2 px-2">Tipo</th>
                <th className="py-2 px-2 text-right">Cant.</th>
                <th className="py-2 px-2 text-right">Precio Unit.</th>
                <th className="py-2 px-2 text-right">Desc.</th>
                <th className="py-2 px-2">ITBIS</th>
                <th className="py-2 px-2">Otros Imp.</th>
                <th className="py-2 px-2 text-right">Total Línea</th>
                <th className="py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const calc = computed.items[idx];
                return (
                  <tr key={idx} className="border-t border-slate-100 dark:border-white/5 align-top">
                    <td className="py-2 px-1.5 min-w-[130px]">
                      <select
                        value={line.productId || ''}
                        onChange={(e) => handlePickProductForLine(idx, e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                      >
                        <option value="">Manual...</option>
                        {dgiiProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} · {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-1.5 min-w-[180px]">
                      <input
                        type="text"
                        value={line.description}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, description: e.target.value } : l))
                          )
                        }
                        placeholder="Descripción del bien o servicio"
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                      />
                    </td>
                    <td className="py-2 px-1.5">
                      <select
                        value={line.itemType}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, itemType: e.target.value as 'BIEN' | 'SERVICIO' } : l
                            )
                          )
                        }
                        className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                      >
                        <option value="SERVICIO">Servicio</option>
                        <option value="BIEN">Bien</option>
                      </select>
                    </td>
                    <td className="py-2 px-1.5 w-20">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={line.quantity}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, quantity: Number(e.target.value) } : l))
                          )
                        }
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-right font-mono"
                      />
                    </td>
                    <td className="py-2 px-1.5 w-28">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.unitPrice}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, unitPrice: Number(e.target.value) } : l))
                          )
                        }
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-right font-mono"
                      />
                    </td>
                    <td className="py-2 px-1.5 w-24">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.discountAmount || 0}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, discountAmount: Number(e.target.value) } : l))
                          )
                        }
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] text-right font-mono"
                      />
                    </td>
                    <td className="py-2 px-1.5">
                      <select
                        value={line.isExempt ? 0 : line.itbisRate}
                        disabled={!ECF_TYPE_META[ecfType].allowsItbis}
                        onChange={(e) => {
                          const rate = Number(e.target.value) as EcfItbisRate;
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, itbisRate: rate, isExempt: rate === 0 } : l
                            )
                          );
                        }}
                        className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                      >
                        <option value={18}>18%</option>
                        <option value={16}>16%</option>
                        <option value={0}>Exento (0%)</option>
                      </select>
                    </td>
                    <td className="py-2 px-1.5">
                      <div className="flex items-center gap-1">
                        <select
                          value={line.otherTaxCode || 'NINGUNO'}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((l, i) =>
                                i === idx ? { ...l, otherTaxCode: e.target.value as OtherTaxCode } : l
                              )
                            )
                          }
                          className="px-1.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                        >
                          <option value="NINGUNO">Ninguno</option>
                          <option value="PROPINA_LEGAL">Propina (10%)</option>
                          <option value="ISC_AD_VALOREM">ISC %</option>
                          <option value="CDT_OTROS">CDT / Otros</option>
                        </select>
                        {line.otherTaxCode && line.otherTaxCode !== 'NINGUNO' && (
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={line.otherTaxRatePct || 0}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l, i) =>
                                  i === idx ? { ...l, otherTaxRatePct: Number(e.target.value) } : l
                                )
                              )
                            }
                            className="w-14 px-1.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono text-right"
                          />
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-bold whitespace-nowrap">
                      {formatMoney(calc?.lineTotal || 0, currency)}
                    </td>
                    <td className="py-2 px-1">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom Summary, Validation & Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Observations + Pre-Issuance Fiscal Validation */}
        <div className="lg:col-span-2 p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold mb-1">Observaciones del Comprobante</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas adicionales impresas en el PDF..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
            />
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#040C1E] border border-slate-200 dark:border-white/10 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                {preValidation.valid ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-500" />
                )}
                <span>Validación Fiscal Pre-Emisión (XSD & Ley 32-23)</span>
              </span>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {preValidation.errors.length} errores · {preValidation.warnings.length} alertas
              </span>
            </div>
            {preValidation.errors.map((err, i) => (
              <p key={i} className="text-[11px] text-rose-600 dark:text-rose-400">
                • {err}
              </p>
            ))}
            {preValidation.warnings.map((w, i) => (
              <p key={i} className="text-[11px] text-amber-600 dark:text-amber-400">
                • {w}
              </p>
            ))}
            {preValidation.valid && preValidation.warnings.length === 0 && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                Todos los campos obligatorios, RNC, reglas e-CF {ecfType} y rango de secuencia e-NCF están listos.
              </p>
            )}
            <div className="pt-1.5 border-t border-slate-200/70 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="font-mono text-slate-600 dark:text-slate-300">
                Esquema XSD activo: <strong>{liveXsdCheck.schemaFileName}</strong> (v{liveXsdCheck.schemaVersion})
              </span>
              <span className={liveXsdCheck.valid ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-amber-600 dark:text-amber-400 font-semibold'}>
                {liveXsdCheck.valid
                  ? `Pre-validación XML/XSD OK (${liveXsdCheck.checksExecuted.length} verificaciones)`
                  : liveXsdCheck.errors[0]}
              </span>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={submitToDgiiAfterSign}
              onChange={(e) => setSubmitToDgiiAfterSign(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span>
              Transmitir automáticamente a DGII ({activeDgiiConfig.environment}) después de firmar XMLDSig
            </span>
          </label>
        </div>

        {/* Totals & Submit */}
        <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Subtotal Bruto</span>
              <span className="font-mono">{formatMoney(computed.subtotal, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Descuentos</span>
              <span className="font-mono text-rose-600">-{formatMoney(computed.totalDiscount, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Monto Exento</span>
              <span className="font-mono">{formatMoney(computed.exemptAmount, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">ITBIS Total</span>
              <span className="font-mono">{formatMoney(computed.totalItbis, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Otros Impuestos</span>
              <span className="font-mono">{formatMoney(computed.otherTaxesTotal, currency)}</span>
            </div>
            <div className="pt-2 border-t border-slate-200 dark:border-white/10 flex justify-between text-sm font-bold">
              <span>TOTAL GENERAL</span>
              <span className="font-mono text-[#0052CC] dark:text-[#00D1FF]">
                {formatMoney(computed.totalAmount, currency)}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              disabled={!canEmit || busy || lines.length === 0}
              onClick={handleSaveDraft}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/15 font-semibold hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>Guardar Borrador (Sin Consumir e-NCF)</span>
            </button>

            <button
              type="button"
              disabled={!canEmit || busy || !preValidation.valid}
              onClick={handleIssueDocument}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
            >
              {submitToDgiiAfterSign ? <Send className="w-4 h-4" /> : <FileCheck2 className="w-4 h-4" />}
              <span>
                {busy
                  ? 'Procesando e-CF...'
                  : submitToDgiiAfterSign
                  ? 'Emitir, Firmar y Enviar'
                  : 'Emitir y Firmar Localmente'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
