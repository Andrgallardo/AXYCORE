import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileUp, Lock, Send, Trash2 } from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import { executeIdempotentDisbursement, generateId } from '../services/axycoreStore';
import { canExecuteDisbursement } from '../engine/workflowGuards';
import { formatMoney, toIsoDateOnly } from '../utils/formatters';
import type { DisbursementRecord } from '../types/axycore';

interface VoucherUploadFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

export function DisbursementsView() {
  const {
    applications,
    committeeDecisions,
    formalizations,
    disbursements,
    userProfile,
    selectedApplicationId,
    setSelectedApplicationId,
    setActiveSection,
    rbac,
  } = useAxyCore();

  const readyInbox = useMemo(
    () => applications.filter((a) => a.status === 'FORMALIZADA'),
    [applications]
  );

  const activeApp = useMemo(() => {
    if (selectedApplicationId) {
      const f = readyInbox.find((a) => a.id === selectedApplicationId);
      if (f) return f;
    }
    return readyInbox[0] ?? null;
  }, [readyInbox, selectedApplicationId]);

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

  const formalization = useMemo(
    () => (activeApp ? formalizations.find((f) => f.applicationId === activeApp.id) ?? null : null),
    [activeApp, formalizations]
  );

  const existingDisb = useMemo(
    () => (activeApp ? disbursements.find((d) => d.applicationId === activeApp.id) ?? null : null),
    [activeApp, disbursements]
  );

  const [paymentMethod, setPaymentMethod] =
    useState<DisbursementRecord['paymentMethod']>('TRANSFERENCIA');
  const [financialEntity, setFinancialEntity] = useState('Banco Popular Dominicano');
  const [destinationAccount, setDestinationAccount] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [disbursementDate, setDisbursementDate] = useState(toIsoDateOnly());
  const [authorizerName, setAuthorizerName] = useState('');
  const [voucherFile, setVoucherFile] = useState<VoucherUploadFile | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateId('idem'));
  const [processing, setProcessing] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    msg: string;
    movedToActive?: boolean;
  } | null>(null);

  useEffect(() => {
    setIdempotencyKey(generateId('idem'));
  }, [activeApp?.id]);

  const preCheck = useMemo(() => {
    if (!activeApp || !userProfile) return null;
    return canExecuteDisbursement({
      userRole: userProfile.role,
      application: activeApp,
      decision,
      formalization,
      existingDisbursementId: existingDisb?.id ?? null,
    });
  }, [activeApp, userProfile, decision, formalization, existingDisb]);

  const handleVoucherFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVoucherError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512_000) {
      setVoucherError('El archivo supera 500 KB. Seleccione una imagen o PDF más liviano.');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl || dataUrl.length > 690_000) {
        setVoucherError('El comprobante codificado supera el límite permitido (~500 KB).');
        return;
      }
      setVoucherFile({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        dataUrl,
      });
    };
    reader.onerror = () => {
      setVoucherError('No se pudo leer el archivo seleccionado.');
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmDisbursement = async () => {
    if (!activeApp || !decision || !formalization || !userProfile) return;
    if (!voucherFile) {
      setFeedback({
        type: 'err',
        msg: 'Suba el comprobante de desembolso (PDF o imagen) antes de presionar Desembolsado.',
      });
      return;
    }
    if (!financialEntity.trim() || !destinationAccount.trim() || referenceNumber.trim().length < 2) {
      setFeedback({
        type: 'err',
        msg: 'Registre la entidad financiera, la cuenta destino y un número de referencia válido (mínimo 2 caracteres) antes de confirmar.',
      });
      return;
    }

    setProcessing(true);
    setFeedback(null);
    try {
      const res = await executeIdempotentDisbursement({
        application: activeApp,
        decision,
        formalization,
        paymentMethod,
        financialEntity: financialEntity.trim(),
        destinationAccountRaw: destinationAccount.trim(),
        referenceNumber: referenceNumber.trim(),
        receiptNotes: receiptNotes.trim(),
        disbursementDate,
        authorizerUserId: userProfile.uid,
        authorizerUserName: authorizerName.trim() || userProfile.displayName,
        idempotencyKey,
        voucherFile,
        user: userProfile,
      });
      setVoucherFile(null);
      setDestinationAccount('');
      setReferenceNumber('');
      setReceiptNotes('');
      setIdempotencyKey(generateId('idem'));
      setFeedback({
        type: 'ok',
        movedToActive: true,
        msg: `Desembolso ${res.disbursement.disbursementNumber} confirmado. El préstamo ${res.loan.loanNumber} pasó oficialmente a la cartera de Activos y se envió un correo al cliente informándole que su préstamo ya se encuentra en su cuenta de banco.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error confirmando el desembolso.',
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
          Desembolso de Créditos Formalizados
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Adjunte el comprobante de desembolso, confirme la entrega de fondos y active oficialmente el préstamo en la cartera de Activos con notificación por correo al cliente.
        </p>
      </div>

      {readyInbox.length === 0 ? (
        <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3">
          {feedback && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 text-left ${
                feedback.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300'
              }`}
            >
              <span>{feedback.msg}</span>
            </div>
          )}
          <p className="text-sm text-slate-500">No hay expedientes formalizados listos para desembolso.</p>
          <button
            type="button"
            onClick={() => setActiveSection('loans')}
            className="px-4 py-2 rounded-lg axy-brand-gradient text-white text-xs font-semibold cursor-pointer"
          >
            Ir a Activos
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-2">
            {readyInbox.map((app) => (
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
                <p className="text-xs font-mono">{formatMoney(app.recommendedAmount ?? app.requestedAmount, app.currency)}</p>
              </button>
            ))}
          </div>

          {activeApp && !formalization && (
            <div className="lg:col-span-8 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800/60 space-y-3 text-xs">
              <p className="font-semibold text-sm text-amber-800 dark:text-amber-300">
                Expediente {activeApp.applicationNumber} sin paquete de formalización registrado
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                Para ejecutar el desembolso de <strong>{activeApp.applicantDisplayName}</strong>, primero completa y confirma el paquete contractual (Pagaré y Contrato) en el módulo de Formalización.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedApplicationId(activeApp.id);
                  setActiveSection('formalization');
                }}
                className="px-4 py-2 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer"
              >
                Ir a Formalización
              </button>
            </div>
          )}

          {activeApp && formalization && (
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
                  {feedback.movedToActive && (
                    <button
                      type="button"
                      onClick={() => setActiveSection('loans')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer"
                    >
                      Ir a Activos
                    </button>
                  )}
                </div>
              )}

              {/* 7 Controls Checklist */}
              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Lock className="w-4 h-4 text-sky-600" />
                  Verificación de Precondiciones de Control Interno
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    ['1. Aprobación vigente', Boolean(decision && ['APROBADO', 'APROBADO_CONDICIONADO'].includes(decision.decision))],
                    ['2. Condiciones de comité cumplidas', Boolean(formalization.conditionsFulfilled)],
                    ['3. Expediente formalizado', activeApp.status === 'FORMALIZADA' && formalization.status === 'LISTA_PARA_DESEMBOLSO'],
                    ['4. Documentos obligatorios completos', formalization.requiredDocsChecklist.every((d) => d.completed)],
                    ['5. Condiciones financieras coincidentes', decision?.approvedAmount === formalization.approvedCapital],
                    ['6. Usuario facultado', rbac.hasPermission('EXECUTE_DISBURSEMENT')],
                    ['7. Sin desembolso previo (Idempotencia)', !existingDisb],
                  ].map(([label, ok]) => (
                    <div key={String(label)} className="flex items-center gap-2">
                      <CheckCircle2 className={`w-4 h-4 ${ok ? 'text-emerald-600' : 'text-rose-600'}`} />
                      <span>{String(label)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {preCheck && !preCheck.allowed && (
                <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                  {preCheck.reason}
                </div>
              )}

              <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 font-mono">
                  <div>
                    <p className="font-sans text-slate-500">Monto Aprobado</p>
                    <p className="font-bold text-sm">{formatMoney(formalization.approvedCapital, activeApp.currency)}</p>
                  </div>
                  <div>
                    <p className="font-sans text-slate-500">Total Financiado</p>
                    <p className="font-bold text-sm">{formatMoney(formalization.totalFinanced, activeApp.currency)}</p>
                  </div>
                  <div>
                    <p className="font-sans text-slate-500">Gastos Totales</p>
                    <p className="font-bold text-sm">{formatMoney(formalization.financedExpenses + formalization.deductedExpenses, activeApp.currency)}</p>
                  </div>
                  <div>
                    <p className="font-sans text-sky-700 dark:text-sky-400">Neto a Entregar</p>
                    <p className="font-bold text-sm">{formatMoney(formalization.netDisbursementAmount, activeApp.currency)}</p>
                  </div>
                </div>

                {/* Upload Comprobante de Desembolso */}
                <div className="p-4 rounded-xl border-2 border-dashed border-[#00B8FF]/40 bg-sky-50/40 dark:bg-[#040C1E]/70 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                        <FileUp className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                        Subir Comprobante de Desembolso (Archivo PDF o Imagen) *
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Adjunta el comprobante bancario de transferencia o depósito (máx. 500 KB) antes de marcar Desembolsado.
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg axy-brand-gradient text-white font-semibold cursor-pointer">
                      <FileUp className="w-3.5 h-3.5" />
                      <span>{voucherFile ? 'Cambiar Archivo' : 'Seleccionar Archivo'}</span>
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        onChange={handleVoucherFileChange}
                        className="sr-only"
                      />
                    </label>
                  </div>

                  {voucherError && (
                    <p className="text-rose-600 dark:text-rose-400 font-medium">{voucherError}</p>
                  )}

                  {voucherFile && (
                    <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-3 min-w-0">
                        {voucherFile.mimeType.startsWith('image/') && (
                          <img
                            src={voucherFile.dataUrl}
                            alt={voucherFile.fileName}
                            className="w-10 h-10 rounded object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-white truncate">
                            {voucherFile.fileName}
                          </p>
                          <p className="text-[10px] font-mono text-slate-500">
                            {voucherFile.mimeType} · {(voucherFile.sizeBytes / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setVoucherFile(null)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Quitar
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block mb-1 text-slate-500">Fecha de Desembolso</label>
                    <input
                      type="date"
                      value={disbursementDate}
                      onChange={(e) => setDisbursementDate(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Medio de Pago</label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as DisbursementRecord['paymentMethod'])}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    >
                      <option value="TRANSFERENCIA">Transferencia Bancaria</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="EFECTIVO_CAJA">Efectivo en Caja</option>
                      <option value="OTRO">Otro</option>
                    </select>
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Entidad Financiera</label>
                    <input
                      value={financialEntity}
                      onChange={(e) => setFinancialEntity(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Cuenta Destino (se almacenará enmascarada) *</label>
                    <input
                      value={destinationAccount}
                      onChange={(e) => setDestinationAccount(e.target.value)}
                      placeholder="Ej. 7845123456"
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Número de Referencia / Comprobante *</label>
                    <input
                      value={referenceNumber}
                      onChange={(e) => setReferenceNumber(e.target.value)}
                      placeholder="Ej. LBTR-2026-99102"
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block mb-1 text-slate-500">Usuario Autorizador</label>
                    <input
                      value={authorizerName}
                      onChange={(e) => setAuthorizerName(e.target.value)}
                      placeholder={userProfile?.displayName}
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                </div>

                <div>
                  <label className="block mb-1 text-slate-500">Evidencia y Notas del Comprobante</label>
                  <textarea
                    rows={2}
                    value={receiptNotes}
                    onChange={(e) => setReceiptNotes(e.target.value)}
                    placeholder="Detalle de comprobante bancario verificado por Operaciones/Finanzas..."
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <span className="font-mono text-slate-500">Llave idempotencia: {idempotencyKey}</span>
                  <button
                    type="button"
                    disabled={processing || !preCheck?.allowed}
                    onClick={handleConfirmDisbursement}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {processing ? 'Procesando desembolso...' : 'Desembolsado'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {disbursements.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="font-display text-sm font-semibold">Desembolsos Confirmados ({disbursements.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
                  <th className="py-2 px-3">N.º Desembolso</th>
                  <th className="py-2 px-3">Fecha</th>
                  <th className="py-2 px-3">Medio / Banco</th>
                  <th className="py-2 px-3">Cuenta Destino</th>
                  <th className="py-2 px-3">Referencia</th>
                  <th className="py-2 px-3">Comprobante</th>
                  <th className="py-2 px-3 text-right">Neto Entregado</th>
                  <th className="py-2 px-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono">
                {disbursements.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 px-3 font-semibold">{d.disbursementNumber}</td>
                    <td className="py-2 px-3">{d.disbursementDate}</td>
                    <td className="py-2 px-3 font-sans">{d.paymentMethod} · {d.financialEntity}</td>
                    <td className="py-2 px-3">{d.destinationAccountMasked}</td>
                    <td className="py-2 px-3">{d.referenceNumber}</td>
                    <td className="py-2 px-3 font-sans">{d.voucherFileName || '—'}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{d.netDeliveredAmount.toLocaleString()}</td>
                    <td className="py-2 px-3 font-sans text-emerald-700 dark:text-emerald-400">{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

