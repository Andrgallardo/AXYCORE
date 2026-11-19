import React from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Database,
  FileWarning,
  RefreshCw,
  ShieldAlert,
  Upload,
  UserCog,
  UserX,
  X,
} from 'lucide-react';
import type {
  PreEvaluationMissingItem,
  PreEvaluationValidationResult,
} from '../engine/preEvaluationValidation';

interface PreEvaluationValidationAlertProps {
  result: PreEvaluationValidationResult;
  revalidating?: boolean;
  onClose: () => void;
  onRevalidate?: () => void;
  onGoToCustomers?: () => void;
  onGoToDocuments?: (applicationId: string) => void;
}

const GROUP_TITLES: Record<PreEvaluationMissingItem['group'], string> = {
  CUSTOMER_RECORD: 'Registro del Cliente en Firestore',
  CUSTOMER_FIELD: 'Campos Obligatorios del Perfil del Cliente',
  BUSINESS_RECORD: 'Registro Empresarial en Firestore',
  BUSINESS_FIELD: 'Campos Obligatorios de la Empresa',
  REQUIRED_DOCUMENT: 'Documentos Requeridos en Firestore',
  APPLICATION_FIELD: 'Datos Obligatorios de la Solicitud',
};

export function PreEvaluationValidationAlert({
  result,
  revalidating = false,
  onClose,
  onRevalidate,
  onGoToCustomers,
  onGoToDocuments,
}: PreEvaluationValidationAlertProps) {
  const customerBlocking = result.blockingIssues.filter(
    (i) => i.group === 'CUSTOMER_RECORD' || i.group === 'CUSTOMER_FIELD'
  );
  const businessBlocking = result.blockingIssues.filter(
    (i) => i.group === 'BUSINESS_RECORD' || i.group === 'BUSINESS_FIELD'
  );
  const documentBlocking = result.blockingIssues.filter((i) => i.group === 'REQUIRED_DOCUMENT');
  const applicationBlocking = result.blockingIssues.filter((i) => i.group === 'APPLICATION_FIELD');

  const needsCustomerAction = customerBlocking.length > 0 || businessBlocking.length > 0;
  const needsDocumentAction = documentBlocking.length > 0;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-2xl border-2 border-rose-300 dark:border-rose-800/80 bg-white dark:bg-slate-900 shadow-lg overflow-hidden text-xs"
    >
      {/* Header */}
      <div className="px-5 py-3.5 bg-rose-50 dark:bg-rose-950/50 border-b border-rose-200 dark:border-rose-900/70 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-900/70 text-rose-700 dark:text-rose-300 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display text-sm font-bold text-rose-950 dark:text-rose-100">
              Envío a Evaluación Bloqueado — Validación Previa en Firestore
            </h3>
            <p className="text-rose-800 dark:text-rose-300 mt-0.5">
              Expediente <span className="font-mono font-bold">{result.applicationNumber}</span> ·{' '}
              <span className="font-semibold">{result.applicantDisplayName}</span>. Complete los{' '}
              <strong>{result.blockingIssues.length}</strong> requisito(s) faltante(s) antes de pasar a Evaluación.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar alerta de validación"
          className="p-1.5 rounded-lg text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Live Firestore Status Strip */}
      <div className="px-5 py-3 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex items-center gap-2.5">
          {result.customerExistsInFirestore ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <UserX className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          )}
          <div>
            <p className="text-[11px] text-slate-500">Perfil Cliente en Firestore</p>
            <p
              className={`font-semibold ${
                result.customerExistsInFirestore
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {result.customerExistsInFirestore ? 'Registrado en Firestore' : 'No existe en Firestore'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Database className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
          <div>
            <p className="text-[11px] text-slate-500">Documentos en Firestore</p>
            <p
              className={`font-semibold ${
                documentBlocking.length === 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {result.documentsCountInFirestore} archivo(s) encontrado(s) ·{' '}
              {documentBlocking.length === 0
                ? 'Completos'
                : `${documentBlocking.length} obligatorio(s) faltante(s)`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {result.applicantType === 'BUSINESS' ? (
            <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
          ) : (
            <FileWarning className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          )}
          <div>
            <p className="text-[11px] text-slate-500">
              {result.applicantType === 'BUSINESS' ? 'Perfil Empresa en Firestore' : 'Resumen de Hallazgos'}
            </p>
            <p className="font-semibold text-slate-900 dark:text-white">
              {result.applicantType === 'BUSINESS'
                ? result.businessExistsInFirestore
                  ? 'Empresa registrada'
                  : 'Empresa faltante'
                : `${result.blockingIssues.length} bloqueante(s) · ${result.warnings.length} advertencia(s)`}
            </p>
          </div>
        </div>
      </div>

      {/* Detailed Missing Requirements Breakdown */}
      <div className="p-5 space-y-4">
        {customerBlocking.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <UserCog className="w-4 h-4 text-rose-600" />
              {GROUP_TITLES.CUSTOMER_FIELD} ({customerBlocking.length})
            </h4>
            <ul className="space-y-1.5">
              {customerBlocking.map((item) => (
                <li
                  key={item.id}
                  className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30"
                >
                  <p className="font-semibold text-rose-900 dark:text-rose-200">{item.label}</p>
                  <p className="text-[11px] text-rose-800/90 dark:text-rose-300/90 mt-0.5">{item.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {businessBlocking.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-rose-600" />
              {GROUP_TITLES.BUSINESS_FIELD} ({businessBlocking.length})
            </h4>
            <ul className="space-y-1.5">
              {businessBlocking.map((item) => (
                <li
                  key={item.id}
                  className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30"
                >
                  <p className="font-semibold text-rose-900 dark:text-rose-200">{item.label}</p>
                  <p className="text-[11px] text-rose-800/90 dark:text-rose-300/90 mt-0.5">{item.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {documentBlocking.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <FileWarning className="w-4 h-4 text-rose-600" />
              {GROUP_TITLES.REQUIRED_DOCUMENT} ({documentBlocking.length})
            </h4>
            <ul className="space-y-1.5">
              {documentBlocking.map((item) => (
                <li
                  key={item.id}
                  className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 flex items-start justify-between gap-3"
                >
                  <div>
                    <p className="font-semibold text-rose-900 dark:text-rose-200">{item.label}</p>
                    <p className="text-[11px] text-rose-800/90 dark:text-rose-300/90 mt-0.5">{item.detail}</p>
                  </div>
                  {item.documentCategory && (
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-900/70 text-rose-800 dark:text-rose-200 shrink-0">
                      {item.documentCategory}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {applicationBlocking.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              {GROUP_TITLES.APPLICATION_FIELD} ({applicationBlocking.length})
            </h4>
            <ul className="space-y-1.5">
              {applicationBlocking.map((item) => (
                <li
                  key={item.id}
                  className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30"
                >
                  <p className="font-semibold text-rose-900 dark:text-rose-200">{item.label}</p>
                  <p className="text-[11px] text-rose-800/90 dark:text-rose-300/90 mt-0.5">{item.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.warnings.length > 0 && (
          <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-800">
            <h4 className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Advertencias Informativas ({result.warnings.length})
            </h4>
            <ul className="space-y-1">
              {result.warnings.map((item) => (
                <li
                  key={item.id}
                  className="p-2 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200"
                >
                  <span className="font-semibold">{item.label}:</span> {item.detail}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Action Bar */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {needsCustomerAction && onGoToCustomers && (
              <button
                type="button"
                onClick={onGoToCustomers}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 text-white font-semibold cursor-pointer"
              >
                <UserCog className="w-3.5 h-3.5" />
                Completar Perfil del Cliente
              </button>
            )}
            {needsDocumentAction && onGoToDocuments && (
              <button
                type="button"
                onClick={() => onGoToDocuments(result.applicationId)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Subir Documentos del Expediente
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onRevalidate && (
              <button
                type="button"
                disabled={revalidating}
                onClick={onRevalidate}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${revalidating ? 'animate-spin' : ''}`} />
                {revalidating ? 'Verificando...' : 'Re-verificar en Firestore'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
