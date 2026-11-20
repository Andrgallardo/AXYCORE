import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileCheck2,
  Plus,
  Scale,
  ShieldAlert,
  UserCheck,
  Users,
} from 'lucide-react';
import { daysBetweenIso, evaluatePlaftRiskProfile } from '../../engine/regulaEngine';
import {
  createRegulaEntity,
  recordRegulaApproval,
  updateRegulaEntity,
} from '../../services/regulaStore';
import type {
  RegulaBeneficiarioFinalRecord,
  RegulaCasoPlaftRecord,
  RegulaDebidaDiligenciaRecord,
  RegulaKycRecord,
  RegulaPerfilRiesgoRecord,
  RegulaSeverity,
} from '../../types/regula';
import type { RegulaWorkspaceState } from './useRegulaWorkspace';

type PlaftTab = 'kyc' | 'debida_diligencia' | 'ubo' | 'perfil_riesgo' | 'monitoreo' | 'casos';

export function RegulaPlaftView({ ws }: { ws: RegulaWorkspaceState }) {
  const [tab, setTab] = useState<PlaftTab>('kyc');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const canCreate = ws.can('plaftpadm', 'crear');
  const canEdit = ws.can('plaftpadm', 'editar');
  const canApprove = ws.can('plaftpadm', 'aprobar');

  const kycList = useMemo(() => ws.data.kyc.filter((k) => !k.deletedAt), [ws.data.kyc]);
  const ddList = useMemo(() => ws.data.debidaDiligencia.filter((d) => !d.deletedAt), [ws.data.debidaDiligencia]);
  const uboList = useMemo(() => ws.data.beneficiariosFinales.filter((b) => !b.deletedAt), [ws.data.beneficiariosFinales]);
  const profilesList = useMemo(() => ws.data.perfilesRiesgo.filter((p) => !p.deletedAt), [ws.data.perfilesRiesgo]);
  const casosList = useMemo(() => ws.data.casosPlaft.filter((c) => !c.deletedAt), [ws.data.casosPlaft]);

  // KYC form linked to AxyCore customers/businesses (no master duplication)
  const [showKycForm, setShowKycForm] = useState(false);
  const [kycForm, setKycForm] = useState({
    linkType: 'CUSTOMER' as 'CUSTOMER' | 'BUSINESS',
    selectedId: '',
    economicActivity: '',
    fundsOrigin: 'Salarios / Ingresos comerciales verificables',
    geographicZone: 'Santo Domingo, RD',
    channel: 'Presencial en sucursal',
    isPep: false,
    pepDetails: '',
    identityVerified: true,
    addressVerified: true,
    fundsOriginVerified: false,
    nextReviewDate: ws.todayIso,
  });

  // DD Form
  const [showDdForm, setShowDdForm] = useState(false);
  const [ddForm, setDdForm] = useState({
    kycId: '',
    level: 'ESTANDAR' as RegulaDebidaDiligenciaRecord['level'],
    nextReviewDate: ws.todayIso,
    identificacionVerificada: true,
    actividadEconomicaVerificada: true,
    origenFondosDocumentado: false,
    beneficiarioFinalIdentificado: false,
    verificacionPepRealizada: true,
    listasRestrictivasVerificadas: false,
    sanctionsCheckNote: 'Verificación manual documental (integración API de listas restrictivas no configurada).',
    analystNotes: '',
  });

  // UBO Form
  const [showUboForm, setShowUboForm] = useState(false);
  const [uboForm, setUboForm] = useState({
    kycId: '',
    beneficiaryName: '',
    documentType: 'CEDULA' as RegulaBeneficiarioFinalRecord['documentType'],
    documentNumber: '',
    nationality: 'Dominicana',
    ownershipPct: 25,
    controlType: 'ACCIONARIO_DIRECTO' as RegulaBeneficiarioFinalRecord['controlType'],
    isPep: false,
    notes: '',
  });

  // Risk Profile Form
  const [profileKycId, setProfileKycId] = useState('');
  const [factorScores, setFactorScores] = useState<Record<string, 1 | 2 | 3 | 4 | 5>>(() =>
    ws.effectiveConfig.plaftFactorWeights.reduce((acc, w) => {
      acc[w.code] = 2;
      return acc;
    }, {} as Record<string, 1 | 2 | 3 | 4 | 5>)
  );

  // Case Form
  const [showCasoForm, setShowCasoForm] = useState(false);
  const [casoForm, setCasoForm] = useState({
    kycId: '',
    alertOrigin: 'OPERACION_INUSUAL' as RegulaCasoPlaftRecord['alertOrigin'],
    title: '',
    description: '',
    severity: 'ALTA' as RegulaSeverity,
    assignedToName: ws.userProfile?.displayName || 'Oficial de Cumplimiento',
    requiresExternalReportReview: false,
  });

  const handleCreateKyc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canCreate) return;
    setMsg(null);
    const customer = kycForm.linkType === 'CUSTOMER' ? ws.customers.find((c) => c.id === kycForm.selectedId) : undefined;
    const business = kycForm.linkType === 'BUSINESS' ? ws.businesses.find((b) => b.id === kycForm.selectedId) : undefined;
    if (!customer && !business) {
      setMsg({ type: 'err', text: 'Selecciona un cliente o empresa existente de AxyCore para vincular KYC sin duplicar maestros.' });
      return;
    }
    try {
      const clientName = customer ? `${customer.firstName} ${customer.lastName}`.trim() : business!.legalName;
      const documentNumber = customer ? customer.documentNumber : business!.rnc;
      const kycStatus: RegulaKycRecord['kycStatus'] =
        kycForm.identityVerified && kycForm.addressVerified && kycForm.fundsOriginVerified
          ? 'COMPLETO'
          : 'PENDIENTE_DOCUMENTOS';

      await createRegulaEntity<RegulaKycRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_kyc',
        prefix: 'rgkyc',
        entityCode: documentNumber,
        auditAction: 'VINCULACION_KYC_PLAFT',
        data: {
          customerId: customer?.id,
          businessId: business?.id,
          clientType: customer ? 'PERSONA_FISICA' : 'PERSONA_JURIDICA',
          clientName,
          documentNumber,
          economicActivity: kycForm.economicActivity.trim() || (customer ? 'Persona Física' : business?.economicActivity || 'Comercial'),
          fundsOrigin: kycForm.fundsOrigin.trim(),
          geographicZone: kycForm.geographicZone.trim(),
          channel: kycForm.channel.trim(),
          productsUsed: ['Crédito AxyCore'],
          isPep: kycForm.isPep,
          pepDetails: kycForm.isPep ? kycForm.pepDetails.trim() : undefined,
          identityVerified: kycForm.identityVerified,
          addressVerified: kycForm.addressVerified,
          fundsOriginVerified: kycForm.fundsOriginVerified,
          kycStatus,
          lastReviewDate: ws.todayIso,
          nextReviewDate: kycForm.nextReviewDate,
          reviewerName: ws.userProfile.displayName || 'Analista',
        },
      });
      setShowKycForm(false);
      setMsg({ type: 'ok', text: `Ficha KYC creada y vinculada al maestro AxyCore para ${clientName}.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error registrando KYC.' });
    }
  };

  const handleCreateDd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canCreate) return;
    const kyc = kycList.find((k) => k.id === ddForm.kycId);
    if (!kyc) {
      setMsg({ type: 'err', text: 'Selecciona una ficha KYC.' });
      return;
    }
    try {
      await createRegulaEntity<RegulaDebidaDiligenciaRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_debida_diligencia',
        prefix: 'rgdd',
        entityCode: kyc.documentNumber,
        auditAction: 'REGISTRO_DEBIDA_DILIGENCIA',
        data: {
          kycId: kyc.id,
          customerId: kyc.customerId,
          clientName: kyc.clientName,
          level: kyc.isPep ? 'AMPLIADA' : ddForm.level,
          status: 'PENDIENTE_APROBACION',
          reviewDate: ws.todayIso,
          nextReviewDate: ddForm.nextReviewDate,
          checklist: {
            identificacionVerificada: ddForm.identificacionVerificada,
            actividadEconomicaVerificada: ddForm.actividadEconomicaVerificada,
            origenFondosDocumentado: ddForm.origenFondosDocumentado,
            beneficiarioFinalIdentificado: ddForm.beneficiarioFinalIdentificado,
            verificacionPepRealizada: ddForm.verificacionPepRealizada,
            listasRestrictivasVerificadas: ddForm.listasRestrictivasVerificadas,
          },
          sanctionsCheckNote: ddForm.sanctionsCheckNote.trim(),
          analystNotes: ddForm.analystNotes.trim(),
        },
      });
      setShowDdForm(false);
      setMsg({ type: 'ok', text: `Debida Diligencia creada para ${kyc.clientName} (pendiente aprobación).` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error registrando Debida Diligencia.' });
    }
  };

  const handleApproveDd = async (dd: RegulaDebidaDiligenciaRecord, decision: 'APROBADO' | 'RECHAZADO') => {
    if (!ws.userProfile || !canApprove) return;
    try {
      const nowIso = new Date().toISOString();
      await updateRegulaEntity<RegulaDebidaDiligenciaRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_debida_diligencia',
        id: dd.id,
        entityCode: dd.clientName,
        auditAction: `DEBIDA_DILIGENCIA_${decision}`,
        patch: {
          status: decision === 'APROBADO' ? 'APROBADA' : 'RECHAZADA',
          approvedBy: ws.userProfile.uid,
          approvedByName: ws.userProfile.displayName || 'Aprobador',
          approvedAt: nowIso,
        },
      });
      await recordRegulaApproval({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        entityType: 'regula_debida_diligencia',
        entityId: dd.id,
        entityCode: dd.clientName,
        approvalAction: 'APROBAR_DEBIDA_DILIGENCIA',
        decision,
        justification: dd.analystNotes || `Debida diligencia ${dd.level}`,
      });
      setMsg({ type: 'ok', text: `Debida Diligencia de ${dd.clientName} marcada como ${decision}.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error aprobando Debida Diligencia.' });
    }
  };

  const handleCreateUbo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canCreate) return;
    const kyc = kycList.find((k) => k.id === uboForm.kycId);
    if (!kyc) {
      setMsg({ type: 'err', text: 'Selecciona el cliente/entidad KYC al que pertenece el beneficiario final.' });
      return;
    }
    try {
      await createRegulaEntity<RegulaBeneficiarioFinalRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_beneficiarios_finales',
        prefix: 'rgubo',
        entityCode: uboForm.documentNumber,
        auditAction: 'REGISTRO_BENEFICIARIO_FINAL',
        data: {
          kycId: kyc.id,
          businessId: kyc.businessId,
          entityName: kyc.clientName,
          beneficiaryName: uboForm.beneficiaryName.trim(),
          documentType: uboForm.documentType,
          documentNumber: uboForm.documentNumber.trim(),
          nationality: uboForm.nationality.trim(),
          ownershipPct: Number(uboForm.ownershipPct) || 0,
          controlType: uboForm.controlType,
          isPep: uboForm.isPep,
          verificationStatus: 'PENDIENTE',
          notes: uboForm.notes.trim() || undefined,
        },
      });
      setShowUboForm(false);
      setUboForm({ ...uboForm, beneficiaryName: '', documentNumber: '', notes: '' });
      setMsg({ type: 'ok', text: 'Beneficiario final (UBO) registrado correctamente.' });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error registrando UBO.' });
    }
  };

  const selectedKycForProfile = kycList.find((k) => k.id === profileKycId);
  const liveProfilePreview = useMemo(() => {
    const inputs = ws.effectiveConfig.plaftFactorWeights
      .filter((w) => w.enabled)
      .map((w) => ({ code: w.code, rawScore: factorScores[w.code] || 2 }));
    return evaluatePlaftRiskProfile({
      factorInputs: inputs,
      isPep: selectedKycForProfile?.isPep,
      config: ws.effectiveConfig,
    });
  }, [ws.effectiveConfig, factorScores, selectedKycForProfile?.isPep]);

  const handleSaveRiskProfile = async () => {
    if (!ws.userProfile || !canCreate || !selectedKycForProfile) return;
    try {
      const nextReview = new Date(`${ws.todayIso}T12:00:00Z`);
      nextReview.setUTCMonth(nextReview.getUTCMonth() + (liveProfilePreview.riskLevel === 'CRITICO' || liveProfilePreview.riskLevel === 'ALTO' ? 6 : 12));
      await createRegulaEntity<RegulaPerfilRiesgoRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_perfiles_riesgo',
        prefix: 'rgprf',
        entityCode: selectedKycForProfile.documentNumber,
        auditAction: 'EVALUACION_PERFIL_RIESGO_PLAFT',
        data: {
          kycId: selectedKycForProfile.id,
          customerId: selectedKycForProfile.customerId,
          clientName: selectedKycForProfile.clientName,
          evaluationDate: ws.todayIso,
          nextReviewDate: nextReview.toISOString().slice(0, 10),
          factors: liveProfilePreview.factors,
          totalScore: liveProfilePreview.totalScore,
          riskLevel: liveProfilePreview.riskLevel,
          recommendedDdLevel: liveProfilePreview.recommendedDdLevel,
          explanation: liveProfilePreview.explanation,
          evaluatedByName: ws.userProfile.displayName || 'Analista',
        },
      });
      setMsg({ type: 'ok', text: `Perfil de Riesgo PLAFTPADM (${liveProfilePreview.riskLevel} · ${liveProfilePreview.totalScore}/100) guardado.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error guardando perfil de riesgo.' });
    }
  };

  const handleCreateCaso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ws.userProfile || !canCreate) return;
    const kyc = kycList.find((k) => k.id === casoForm.kycId);
    const code = `PLAFT-${String(casosList.length + 1).padStart(3, '0')}`;
    try {
      await createRegulaEntity<RegulaCasoPlaftRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_casos_plaft',
        prefix: 'rgcas',
        entityCode: code,
        auditAction: 'APERTURA_CASO_PLAFT',
        data: {
          code,
          kycId: kyc?.id,
          customerId: kyc?.customerId,
          clientName: kyc?.clientName || 'Cliente / Operación por identificar',
          alertOrigin: casoForm.alertOrigin,
          title: casoForm.title.trim(),
          description: casoForm.description.trim(),
          severity: casoForm.severity,
          status: 'ABIERTO',
          assignedToName: casoForm.assignedToName.trim(),
          requiresExternalReportReview: casoForm.requiresExternalReportReview,
          linkedEvidenceIds: [],
          linkedActionPlanIds: [],
          openedDate: ws.todayIso,
        },
      });
      setShowCasoForm(false);
      setCasoForm({ ...casoForm, title: '', description: '' });
      setMsg({ type: 'ok', text: `Caso ${code} abierto. Toda decisión final requiere revisión humana documentada.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error abriendo caso PLAFTPADM.' });
    }
  };

  const handleUpdateCasoStatus = async (caso: RegulaCasoPlaftRecord, nextStatus: RegulaCasoPlaftRecord['status']) => {
    if (!ws.userProfile || !canEdit) return;
    try {
      await updateRegulaEntity<RegulaCasoPlaftRecord>({
        user: ws.userProfile,
        organizationId: ws.orgId,
        config: ws.effectiveConfig,
        collectionName: 'regula_casos_plaft',
        id: caso.id,
        entityCode: caso.code,
        auditAction: 'ACTUALIZACION_CASO_PLAFT',
        previousSummary: caso.status,
        newSummary: nextStatus,
        patch: {
          status: nextStatus,
          closedDate: nextStatus === 'CERRADO' || nextStatus === 'DESCARTADO_JUSTIFICADO' ? ws.todayIso : undefined,
        },
      });
      setMsg({ type: 'ok', text: `Caso ${caso.code} actualizado a ${nextStatus}.` });
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Error actualizando caso.' });
    }
  };

  const tabs: Array<{ id: PlaftTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'kyc', label: `KYC Vinculado (${kycList.length})`, icon: UserCheck },
    { id: 'debida_diligencia', label: `Debida Diligencia (${ddList.length})`, icon: FileCheck2 },
    { id: 'ubo', label: `Beneficiarios Finales (${uboList.length})`, icon: Users },
    { id: 'perfil_riesgo', label: `Perfil de Riesgo (${profilesList.length})`, icon: Scale },
    { id: 'monitoreo', label: 'Monitoreo y Revisiones', icon: Eye },
    { id: 'casos', label: `Alertas y Casos (${casosList.length})`, icon: ShieldAlert },
  ];

  return (
    <div className="space-y-5">
      {/* Human Safeguard Banner */}
      <div className="axy-surface-tonal rounded-xl px-4 py-3 border border-sky-500/20 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <span>
          <strong>Salvaguarda PLAFTPADM (Ley 155-17):</strong> REGULA vincula expedientes directamente al maestro de
          clientes/empresas de AxyCore sin duplicarlos. Ningún caso se declara culpable ni se reporta automáticamente a
          autoridades; toda escalación exige revisión y aprobación humana del Oficial de Cumplimiento.
        </span>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer ${
                active ? 'axy-brand-gradient text-white' : 'axy-surface text-slate-700 dark:text-slate-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {msg && (
        <div
          className={`px-4 py-2.5 rounded-xl text-xs flex justify-between ${
            msg.type === 'ok'
              ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-500/10 border border-rose-500/25 text-rose-800 dark:text-rose-200'
          }`}
        >
          <span>{msg.text}</span>
          <button type="button" onClick={() => setMsg(null)} className="underline cursor-pointer">Cerrar</button>
        </div>
      )}

      {/* TAB 1: KYC */}
      {tab === 'kyc' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Cobertura KYC vs. Maestro AxyCore:{' '}
              <strong className="font-mono">{ws.ecosystemSignals.customersWithRegulaKyc} / {ws.ecosystemSignals.totalCustomersMaster}</strong>{' '}
              clientes personales · {ws.ecosystemSignals.totalBusinessesMaster} empresas en maestro.
            </div>
            {canCreate && (
              <button
                type="button"
                onClick={() => setShowKycForm((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Vincular Cliente / Empresa a KYC</span>
              </button>
            )}
          </div>

          {showKycForm && (
            <form onSubmit={handleCreateKyc} className="axy-surface rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-semibold">Tipo de Maestro AxyCore</label>
                <select
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={kycForm.linkType}
                  onChange={(e) => setKycForm({ ...kycForm, linkType: e.target.value as 'CUSTOMER' | 'BUSINESS', selectedId: '' })}
                >
                  <option value="CUSTOMER">Persona Física (Maestro Clientes)</option>
                  <option value="BUSINESS">Persona Jurídica (Maestro Empresas)</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-[11px] font-semibold">Seleccionar Registro Existente *</label>
                <select
                  required
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={kycForm.selectedId}
                  onChange={(e) => setKycForm({ ...kycForm, selectedId: e.target.value })}
                >
                  <option value="">Elige un registro de AxyCore...</option>
                  {kycForm.linkType === 'CUSTOMER'
                    ? ws.customers.map((c) => (
                        <option key={c.id} value={c.id}>{`${c.firstName} ${c.lastName}`.trim()} ({c.documentNumber})</option>
                      ))
                    : ws.businesses.map((b) => (
                        <option key={b.id} value={b.id}>{b.legalName} ({b.rnc})</option>
                      ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold">Actividad Económica</label>
                <input
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  placeholder="Ej. Comercio minorista / Servicios"
                  value={kycForm.economicActivity}
                  onChange={(e) => setKycForm({ ...kycForm, economicActivity: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold">Origen de Fondos *</label>
                <input
                  required
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={kycForm.fundsOrigin}
                  onChange={(e) => setKycForm({ ...kycForm, fundsOrigin: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold">Próxima Revisión KYC</label>
                <input
                  type="date"
                  className="axy-input mt-1 w-full px-3 py-2 text-xs"
                  value={kycForm.nextReviewDate}
                  onChange={(e) => setKycForm({ ...kycForm, nextReviewDate: e.target.value })}
                />
              </div>
              <div className="md:col-span-3 flex flex-wrap gap-4 text-xs pt-1">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={kycForm.identityVerified} onChange={(e) => setKycForm({ ...kycForm, identityVerified: e.target.checked })} />
                  <span>Identidad verificada</span>
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={kycForm.addressVerified} onChange={(e) => setKycForm({ ...kycForm, addressVerified: e.target.checked })} />
                  <span>Domicilio verificado</span>
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={kycForm.fundsOriginVerified} onChange={(e) => setKycForm({ ...kycForm, fundsOriginVerified: e.target.checked })} />
                  <span>Origen de fondos documentado</span>
                </label>
                <label className="inline-flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
                  <input type="checkbox" checked={kycForm.isPep} onChange={(e) => setKycForm({ ...kycForm, isPep: e.target.checked })} />
                  <span>Persona Expuesta Políticamente (PEP)</span>
                </label>
              </div>
              {kycForm.isPep && (
                <div className="md:col-span-3">
                  <input
                    className="axy-input w-full px-3 py-2 text-xs"
                    placeholder="Detalle cargo público o vinculación PEP..."
                    value={kycForm.pepDetails}
                    onChange={(e) => setKycForm({ ...kycForm, pepDetails: e.target.value })}
                  />
                </div>
              )}
              <div className="md:col-span-3 flex justify-end gap-2">
                <button type="button" onClick={() => setShowKycForm(false)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">Cancelar</button>
                <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">Guardar Ficha KYC</button>
              </div>
            </form>
          )}

          <div className="axy-surface rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-white/[0.03] text-[11px] uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Cliente / Documento</th>
                    <th className="px-3 py-3">Tipo</th>
                    <th className="px-3 py-3">Actividad / Origen Fondos</th>
                    <th className="px-3 py-3">PEP</th>
                    <th className="px-3 py-3">Estado KYC</th>
                    <th className="px-3 py-3">Próxima Rev.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                  {kycList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No hay expedientes KYC registrados todavía. Vincula un cliente o empresa del maestro AxyCore.
                      </td>
                    </tr>
                  ) : (
                    kycList.map((k) => (
                      <tr key={k.id}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 dark:text-white">{k.clientName}</div>
                          <div className="font-mono text-[11px] text-slate-500">{k.documentNumber}</div>
                        </td>
                        <td className="px-3 py-3">{k.clientType}</td>
                        <td className="px-3 py-3">
                          <div>{k.economicActivity}</div>
                          <div className="text-[11px] text-slate-500">{k.fundsOrigin}</div>
                        </td>
                        <td className="px-3 py-3">
                          {k.isPep ? (
                            <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold text-[10px]">PEP</span>
                          ) : 'No'}
                        </td>
                        <td className="px-3 py-3 font-semibold">{k.kycStatus}</td>
                        <td className="px-3 py-3 font-mono">{k.nextReviewDate}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DEBIDA DILIGENCIA */}
      {tab === 'debida_diligencia' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
              Debida Diligencia Simplificada, Estándar y Ampliada
            </h3>
            {canCreate && (
              <button type="button" onClick={() => setShowDdForm((v) => !v)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer">
                <Plus className="w-3.5 h-3.5" />
                <span>Nueva Debida Diligencia</span>
              </button>
            )}
          </div>

          {showDdForm && (
            <form onSubmit={handleCreateDd} className="axy-surface rounded-2xl p-5 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <select required className="axy-input px-3 py-2 text-xs" value={ddForm.kycId} onChange={(e) => setDdForm({ ...ddForm, kycId: e.target.value })}>
                  <option value="">Selecciona ficha KYC...</option>
                  {kycList.map((k) => <option key={k.id} value={k.id}>{k.clientName} ({k.documentNumber})</option>)}
                </select>
                <select className="axy-input px-3 py-2 text-xs" value={ddForm.level} onChange={(e) => setDdForm({ ...ddForm, level: e.target.value as RegulaDebidaDiligenciaRecord['level'] })}>
                  <option value="SIMPLIFICADA">Simplificada</option>
                  <option value="ESTANDAR">Estándar</option>
                  <option value="AMPLIADA">Ampliada</option>
                </select>
                <input type="date" className="axy-input px-3 py-2 text-xs" value={ddForm.nextReviewDate} onChange={(e) => setDdForm({ ...ddForm, nextReviewDate: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                {[
                  ['identificacionVerificada', 'Identificación verificada'],
                  ['actividadEconomicaVerificada', 'Actividad económica verificada'],
                  ['origenFondosDocumentado', 'Origen de fondos documentado'],
                  ['beneficiarioFinalIdentificado', 'Beneficiario final (UBO) identificado'],
                  ['verificacionPepRealizada', 'Verificación PEP realizada'],
                  ['listasRestrictivasVerificadas', 'Listas restrictivas verificadas'],
                ].map(([key, label]) => (
                  <label key={key} className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={Boolean(ddForm[key as keyof typeof ddForm])}
                      onChange={(e) => setDdForm({ ...ddForm, [key]: e.target.checked })}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <input
                className="axy-input w-full px-3 py-2 text-xs"
                placeholder="Fuente / nota de verificación de listas restrictivas"
                value={ddForm.sanctionsCheckNote}
                onChange={(e) => setDdForm({ ...ddForm, sanctionsCheckNote: e.target.value })}
              />
              <textarea
                rows={2}
                className="axy-input w-full px-3 py-2 text-xs"
                placeholder="Observaciones del analista..."
                value={ddForm.analystNotes}
                onChange={(e) => setDdForm({ ...ddForm, analystNotes: e.target.value })}
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowDdForm(false)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">Cancelar</button>
                <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">Guardar y Enviar a Aprobación</button>
              </div>
            </form>
          )}

          <div className="axy-surface rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-white/[0.03] text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-3 py-3">Nivel DD</th>
                  <th className="px-3 py-3">Checklist</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Aprobación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {ddList.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Sin debidas diligencias registradas.</td></tr>
                ) : (
                  ddList.map((d) => {
                    const checked = Object.values(d.checklist).filter(Boolean).length;
                    return (
                      <tr key={d.id}>
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{d.clientName}</td>
                        <td className="px-3 py-3 font-bold">{d.level}</td>
                        <td className="px-3 py-3 font-mono">{checked}/6 ítems</td>
                        <td className="px-3 py-3">{d.status}</td>
                        <td className="px-4 py-3 text-right space-x-2">
                          {canApprove && d.status === 'PENDIENTE_APROBACION' && (
                            <>
                              <button type="button" onClick={() => handleApproveDd(d, 'APROBADO')} className="px-2.5 py-1 rounded bg-emerald-600 text-white text-[11px] font-semibold cursor-pointer">
                                Aprobar
                              </button>
                              <button type="button" onClick={() => handleApproveDd(d, 'RECHAZADO')} className="px-2.5 py-1 rounded bg-rose-600 text-white text-[11px] font-semibold cursor-pointer">
                                Rechazar
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: BENEFICIARIOS FINALES (UBO) */}
      {tab === 'ubo' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
              Registro de Beneficiarios Finales (UBO)
            </h3>
            {canCreate && (
              <button type="button" onClick={() => setShowUboForm((v) => !v)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer">
                <Plus className="w-3.5 h-3.5" />
                <span>Registrar Beneficiario Final</span>
              </button>
            )}
          </div>

          {showUboForm && (
            <form onSubmit={handleCreateUbo} className="axy-surface rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <select required className="axy-input px-3 py-2 text-xs" value={uboForm.kycId} onChange={(e) => setUboForm({ ...uboForm, kycId: e.target.value })}>
                <option value="">Selecciona entidad/cliente KYC...</option>
                {kycList.map((k) => <option key={k.id} value={k.id}>{k.clientName}</option>)}
              </select>
              <input required placeholder="Nombre del Beneficiario Final *" className="axy-input px-3 py-2 text-xs" value={uboForm.beneficiaryName} onChange={(e) => setUboForm({ ...uboForm, beneficiaryName: e.target.value })} />
              <input required placeholder="Documento (Cédula / Pasaporte) *" className="axy-input px-3 py-2 text-xs" value={uboForm.documentNumber} onChange={(e) => setUboForm({ ...uboForm, documentNumber: e.target.value })} />
              <input type="number" min={0} max={100} placeholder="% Participación" className="axy-input px-3 py-2 text-xs" value={uboForm.ownershipPct} onChange={(e) => setUboForm({ ...uboForm, ownershipPct: Number(e.target.value) })} />
              <select className="axy-input px-3 py-2 text-xs" value={uboForm.controlType} onChange={(e) => setUboForm({ ...uboForm, controlType: e.target.value as RegulaBeneficiarioFinalRecord['controlType'] })}>
                <option value="ACCIONARIO_DIRECTO">Accionario Directo</option>
                <option value="ACCIONARIO_INDIRECTO">Accionario Indirecto</option>
                <option value="CONTROL_EFECTIVO">Control Efectivo</option>
                <option value="REPRESENTACION_LEGAL">Representación Legal</option>
              </select>
              <label className="inline-flex items-center gap-2 text-xs">
                <input type="checkbox" checked={uboForm.isPep} onChange={(e) => setUboForm({ ...uboForm, isPep: e.target.checked })} />
                <span>Beneficiario es PEP</span>
              </label>
              <div className="md:col-span-3 flex justify-end gap-2">
                <button type="button" onClick={() => setShowUboForm(false)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">Cancelar</button>
                <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">Guardar Beneficiario</button>
              </div>
            </form>
          )}

          <div className="axy-surface rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-white/[0.03] text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Entidad</th>
                  <th className="px-3 py-3">Beneficiario Final</th>
                  <th className="px-3 py-3">Documento</th>
                  <th className="px-3 py-3">% / Control</th>
                  <th className="px-3 py-3">PEP</th>
                  <th className="px-3 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {uboList.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No hay beneficiarios finales registrados.</td></tr>
                ) : (
                  uboList.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-3 font-semibold">{u.entityName}</td>
                      <td className="px-3 py-3">{u.beneficiaryName}</td>
                      <td className="px-3 py-3 font-mono">{u.documentNumber}</td>
                      <td className="px-3 py-3 font-mono">{u.ownershipPct}% · {u.controlType}</td>
                      <td className="px-3 py-3">{u.isPep ? 'Sí (PEP)' : 'No'}</td>
                      <td className="px-3 py-3">{u.verificationStatus}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: PERFIL DE RIESGO CONFIGURABLE */}
      {tab === 'perfil_riesgo' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 axy-surface rounded-2xl p-5 space-y-4">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
              Calculadora Explicable de Perfil de Riesgo PLAFTPADM
            </h3>
            <select
              className="axy-input w-full px-3 py-2 text-xs"
              value={profileKycId}
              onChange={(e) => setProfileKycId(e.target.value)}
            >
              <option value="">Selecciona una ficha KYC para evaluar...</option>
              {kycList.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.clientName} ({k.documentNumber}){k.isPep ? ' · PEP' : ''}
                </option>
              ))}
            </select>

            <div className="space-y-2.5">
              {ws.effectiveConfig.plaftFactorWeights.filter((w) => w.enabled).map((w) => (
                <div key={w.code} className="p-3 rounded-xl axy-surface-tonal flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      {w.label} <span className="font-mono text-[10px] text-slate-500">({w.weightPct}%)</span>
                    </div>
                    <div className="text-[11px] text-slate-500">{w.description}</div>
                  </div>
                  <select
                    className="axy-input px-2.5 py-1.5 text-xs font-mono"
                    value={factorScores[w.code] || 2}
                    onChange={(e) => setFactorScores({ ...factorScores, [w.code]: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 })}
                  >
                    <option value={1}>1 - Muy Bajo</option>
                    <option value={2}>2 - Bajo</option>
                    <option value={3}>3 - Medio</option>
                    <option value={4}>4 - Alto</option>
                    <option value={5}>5 - Crítico</option>
                  </select>
                </div>
              ))}
            </div>

            <div className="p-4 rounded-xl axy-surface-ai space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white">Resultado Ponderado</span>
                <span className="font-mono text-lg font-bold text-[#0052CC] dark:text-[#00D1FF]">
                  {liveProfilePreview.totalScore}/100 · {liveProfilePreview.riskLevel}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">{liveProfilePreview.explanation}</p>
              {canCreate && (
                <button
                  type="button"
                  disabled={!selectedKycForProfile}
                  onClick={handleSaveRiskProfile}
                  className="px-4 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer disabled:opacity-50"
                >
                  Guardar Evaluación en Historial PLAFTPADM
                </button>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 axy-surface rounded-2xl p-5 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
              Perfiles Evaluados ({profilesList.length})
            </h3>
            {profilesList.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">Sin perfiles evaluados aún.</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/[0.06] max-h-96 overflow-y-auto">
                {profilesList.map((p) => (
                  <div key={p.id} className="py-2.5 space-y-1">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-900 dark:text-white">{p.clientName}</span>
                      <span className="font-mono">{p.totalScore}/100 · {p.riskLevel}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      DD Recomendada: <strong>{p.recommendedDdLevel}</strong> · Próx. rev.: {p.nextReviewDate}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: MONITOREO Y REVISIONES */}
      {tab === 'monitoreo' && (
        <div className="axy-surface rounded-2xl p-5 space-y-4">
          <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
            Monitoreo de Revisiones Periódicas KYC y Señales Centinela
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl axy-surface-tonal">
              <div className="text-xs text-slate-500">KYC Próximos / Vencidos</div>
              <div className="font-mono text-2xl font-bold text-slate-950 dark:text-white mt-1">
                {kycList.filter((k) => daysBetweenIso(ws.todayIso, k.nextReviewDate) <= 30).length}
              </div>
            </div>
            <div className="p-4 rounded-xl axy-surface-tonal">
              <div className="text-xs text-slate-500">Clientes PEP en Monitoreo</div>
              <div className="font-mono text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                {kycList.filter((k) => k.isPep).length}
              </div>
            </div>
            <div className="p-4 rounded-xl axy-surface-tonal">
              <div className="text-xs text-slate-500">Alertas Centinela (Lectura)</div>
              <div className="font-mono text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
                {ws.ecosystemSignals.centinelaActiveAlerts}
              </div>
            </div>
          </div>
          {kycList.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">Sin expedientes KYC en monitoreo.</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
              {kycList.map((k) => {
                const days = daysBetweenIso(ws.todayIso, k.nextReviewDate);
                return (
                  <div key={k.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">{k.clientName}</div>
                      <div className="text-[11px] text-slate-500">Última revisión: {k.lastReviewDate} · Estado: {k.kycStatus}</div>
                    </div>
                    <div className={`font-mono font-bold ${days < 0 ? 'text-rose-600' : days <= 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {days < 0 ? `${Math.abs(days)}d vencido` : `en ${days}d`}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 6: ALERTAS Y CASOS PLAFTPADM */}
      {tab === 'casos' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
              Gestión de Alertas y Casos en Investigación PLAFTPADM
            </h3>
            {canCreate && (
              <button type="button" onClick={() => setShowCasoForm((v) => !v)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-btn-primary text-xs cursor-pointer">
                <Plus className="w-3.5 h-3.5" />
                <span>Abrir Caso PLAFTPADM</span>
              </button>
            )}
          </div>

          {showCasoForm && (
            <form onSubmit={handleCreateCaso} className="axy-surface rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <select className="axy-input px-3 py-2 text-xs" value={casoForm.kycId} onChange={(e) => setCasoForm({ ...casoForm, kycId: e.target.value })}>
                <option value="">Cliente KYC (opcional)</option>
                {kycList.map((k) => <option key={k.id} value={k.id}>{k.clientName}</option>)}
              </select>
              <select className="axy-input px-3 py-2 text-xs" value={casoForm.alertOrigin} onChange={(e) => setCasoForm({ ...casoForm, alertOrigin: e.target.value as RegulaCasoPlaftRecord['alertOrigin'] })}>
                <option value="OPERACION_INUSUAL">Operación Inusual</option>
                <option value="CENTINELA_AXYCORE">Alerta Centinela AxyCore</option>
                <option value="MONITOREO_TRANSACCIONAL">Monitoreo Transaccional</option>
                <option value="REVISION_KYC">Revisión KYC</option>
                <option value="PEP_IDENTIFICADO">PEP Identificado</option>
                <option value="REPORTADO_INTERNAMENTE">Reportado Internamente</option>
              </select>
              <select className="axy-input px-3 py-2 text-xs" value={casoForm.severity} onChange={(e) => setCasoForm({ ...casoForm, severity: e.target.value as RegulaSeverity })}>
                <option value="MEDIA">Media</option>
                <option value="ALTA">Alta</option>
                <option value="CRITICA">Crítica</option>
              </select>
              <input required placeholder="Título del caso *" className="axy-input md:col-span-2 px-3 py-2 text-xs" value={casoForm.title} onChange={(e) => setCasoForm({ ...casoForm, title: e.target.value })} />
              <input required placeholder="Responsable asignado" className="axy-input px-3 py-2 text-xs" value={casoForm.assignedToName} onChange={(e) => setCasoForm({ ...casoForm, assignedToName: e.target.value })} />
              <textarea required rows={2} placeholder="Descripción objetiva de la señal u operación observada..." className="axy-input md:col-span-3 px-3 py-2 text-xs" value={casoForm.description} onChange={(e) => setCasoForm({ ...casoForm, description: e.target.value })} />
              <label className="md:col-span-3 inline-flex items-center gap-2 text-xs">
                <input type="checkbox" checked={casoForm.requiresExternalReportReview} onChange={(e) => setCasoForm({ ...casoForm, requiresExternalReportReview: e.target.checked })} />
                <span>Marcar para evaluación humana por el Oficial de Cumplimiento (posible reporte externo oficial fuera de línea)</span>
              </label>
              <div className="md:col-span-3 flex justify-end gap-2">
                <button type="button" onClick={() => setShowCasoForm(false)} className="px-3 py-1.5 rounded-lg axy-btn-secondary text-xs cursor-pointer">Cancelar</button>
                <button type="submit" className="px-4 py-1.5 rounded-lg axy-btn-primary text-xs cursor-pointer">Abrir Caso</button>
              </div>
            </form>
          )}

          <div className="axy-surface rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-white/[0.03] text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Código / Caso</th>
                  <th className="px-3 py-3">Cliente</th>
                  <th className="px-3 py-3">Origen</th>
                  <th className="px-3 py-3">Severidad</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Gestión Humana</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                {casosList.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Sin casos PLAFTPADM abiertos.</td></tr>
                ) : (
                  casosList.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-3">
                        <div className="font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">{c.code}</div>
                        <div className="font-semibold text-slate-900 dark:text-white">{c.title}</div>
                      </td>
                      <td className="px-3 py-3">{c.clientName}</td>
                      <td className="px-3 py-3">{c.alertOrigin}</td>
                      <td className="px-3 py-3 font-bold">{c.severity}</td>
                      <td className="px-3 py-3">{c.status}</td>
                      <td className="px-4 py-3 text-right">
                        {canEdit && (
                          <select
                            className="axy-input px-2 py-1 text-[11px]"
                            value={c.status}
                            onChange={(e) => handleUpdateCasoStatus(c, e.target.value as RegulaCasoPlaftRecord['status'])}
                          >
                            <option value="ABIERTO">Abierto</option>
                            <option value="EN_INVESTIGACION">En Investigación</option>
                            <option value="PENDIENTE_COMITE_CUMPLIMIENTO">Pendiente Comité</option>
                            <option value="ESCALADO_OFICIAL_CUMPLIMIENTO">Escalado Oficial</option>
                            <option value="DESCARTADO_JUSTIFICADO">Descartado Justificado</option>
                            <option value="CERRADO">Cerrado</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
