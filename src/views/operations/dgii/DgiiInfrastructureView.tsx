import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  KeyRound,
  ListOrdered,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useAxyCore } from '../../../context/AxyCoreContext';
import {
  formatEncf,
  OFFICIAL_DGII_ENV_ENDPOINTS,
  validateDominicanRnc,
} from '../../../engine/dgii/dgiiCatalogAndValidation';
import { buildDgiiEcfXml } from '../../../engine/dgii/dgiiXmlEngine';
import {
  listLoadedDgiiXsdSchemas,
  validateEcfBeforeDigitalSignature,
} from '../../../engine/dgii/xmlValidator';
import { generateId } from '../../../services/axycoreStore';
import {
  createDgiiSequenceRange,
  logDgiiCustomAuditEvent,
  saveDgiiCertificateMetadata,
  saveDgiiFiscalConfig,
  updateDgiiSequenceStatus,
} from '../../../services/dgiiEcfStore';
import {
  ALL_ECF_TYPES,
  ECF_TYPE_META,
  type DgiiCertificateRecord,
  type DgiiEcfDocumentRecord,
  type DgiiEnvironment,
  type DgiiFiscalConfigRecord,
  type EcfTypeCode,
} from '../../../types/dgiiEcf';

export function DgiiInfrastructureView({
  mode,
}: {
  mode: 'sequences' | 'certificates' | 'config' | 'sandbox';
}) {
  const {
    organization,
    userProfile,
    rbac,
    activeDgiiConfig,
    dgiiSequences,
    dgiiCertificates,
    accountingAccounts,
  } = useAxyCore();

  const canManageSeq = rbac.hasPermission('MANAGE_ECF_SEQUENCES');
  const canManageCert = rbac.hasPermission('MANAGE_ECF_CERTIFICATES');
  const canManageConfig = rbac.hasPermission('MANAGE_DGII_CONFIG');

  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Sequence form state
  const [seqType, setSeqType] = useState<EcfTypeCode>('31');
  const [seqAuthNum, setSeqAuthNum] = useState('');
  const [seqAuthDate, setSeqAuthDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [seqExpiryDate, setSeqExpiryDate] = useState('2027-12-31');
  const [seqStart, setSeqStart] = useState(1);
  const [seqEnd, setSeqEnd] = useState(500);

  // Certificate upload state (password stays strictly in local state & goes straight to backend encrypted vault)
  const [certAlias, setCertAlias] = useState('');
  const [certFileBase64, setCertFileBase64] = useState('');
  const [certFileName, setCertFileName] = useState('');
  const [certPassword, setCertPassword] = useState('');

  // Config draft state
  const [configDraft, setConfigDraft] = useState<DgiiFiscalConfigRecord>(activeDgiiConfig);
  useEffect(() => {
    setConfigDraft(activeDgiiConfig);
  }, [activeDgiiConfig]);

  // Sandbox runner state
  const [sandboxAuthStatus, setSandboxAuthStatus] = useState<string>('');
  const [sandboxServiceStatus, setSandboxServiceStatus] = useState<string>('');
  const [sandboxResults, setSandboxResults] = useState<
    Array<{ ecfType: EcfTypeCode; xmlOk: boolean; signOk: boolean; details: string }>
  >([]);

  const activeCert = useMemo(
    () => dgiiCertificates.find((c) => c.status === 'ACTIVO' || c.status === 'POR_VENCER') ?? null,
    [dgiiCertificates]
  );

  const postableAccounts = useMemo(
    () => accountingAccounts.filter((a) => a.isPostable && a.status === 'ACTIVA'),
    [accountingAccounts]
  );

  const loadedXsdSchemas = useMemo(() => listLoadedDgiiXsdSchemas(), []);

  // Compute certificate expiry status dynamically
  const certRows = useMemo(() => {
    const now = Date.now();
    return dgiiCertificates.map((c) => {
      const expMs = new Date(c.validTo).getTime();
      const daysLeft = Math.ceil((expMs - now) / (1000 * 60 * 60 * 24));
      return { ...c, daysLeft };
    });
  }, [dgiiCertificates]);

  const handleCreateSequence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageSeq || !userProfile) return;
    setBusy(true);
    setFeedback(null);
    try {
      await createDgiiSequenceRange({
        sequence: {
          id: generateId('dgseq'),
          organizationId: organization.id,
          ecfType: seqType,
          prefix: `E${seqType}`,
          authorizationNumber: seqAuthNum.trim() || `AUT-${Date.now().toString().slice(-6)}`,
          authDate: seqAuthDate,
          expiryDate: seqExpiryDate,
          startSequence: Number(seqStart),
          endSequence: Number(seqEnd),
          lastUsedSequence: Number(seqStart) - 1,
          status: 'ACTIVA',
          createdBy: userProfile.uid,
        },
        user: userProfile,
        environment: activeDgiiConfig.environment,
      });
      setSeqAuthNum('');
      setFeedback({
        kind: 'ok',
        text: `Rango ${formatEncf(seqType, seqStart)} – ${formatEncf(seqType, seqEnd)} registrado correctamente.`,
      });
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Error registrando secuencia.' });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleSequenceStatus = async (
    seq: DgiiInfraSeqItem,
    nextStatus: 'ACTIVA' | 'SUSPENDIDA'
  ) => {
    if (!canManageSeq) return;
    setBusy(true);
    try {
      await updateDgiiSequenceStatus({ sequence: seq, status: nextStatus });
      setFeedback({ kind: 'ok', text: `Rango ${seq.prefix} actualizado a ${nextStatus}.` });
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Error actualizando secuencia.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSelectP12File = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCertFileName(file.name);
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    setCertFileBase64(btoa(binary));
  };

  const handleUploadCertificate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageCert || !userProfile || !certFileBase64) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/dgii/certificates/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: organization.id,
          p12Base64: certFileBase64,
          password: certPassword,
          organization,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Error validando certificado PKCS#12.');
      }

      const meta = json.metadata;
      const daysLeft = Math.ceil((new Date(meta.validTo).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      const status: DgiiCertificateRecord['status'] =
        daysLeft <= 0 ? 'VENCIDO' : daysLeft <= 30 ? 'POR_VENCER' : 'ACTIVO';

      await saveDgiiCertificateMetadata({
        cert: {
          id: generateId('dgcert'),
          organizationId: organization.id,
          alias: certAlias.trim() || certFileName || 'Certificado Firma e-CF',
          subjectCn: meta.subjectCn,
          subjectRnc: meta.subjectRnc || activeDgiiConfig.rnc,
          issuerCn: meta.issuerCn,
          serialNumber: meta.serialNumber,
          fingerprintSha256: meta.fingerprintSha256,
          validFrom: meta.validFrom,
          validTo: meta.validTo,
          status,
          vaultKeyId: meta.vaultKeyId,
          hasPrivateKey: true,
          uploadedBy: userProfile.uid,
          uploadedByName: userProfile.displayName,
        },
        previousActiveCerts: dgiiCertificates,
        user: userProfile,
        environment: activeDgiiConfig.environment,
      });

      setCertPassword('');
      setCertFileBase64('');
      setCertFileName('');
      setCertAlias('');
      setFeedback({
        kind: 'ok',
        text: `Certificado "${meta.subjectCn}" cifrado con AES-256-GCM en bóveda del servidor. Nunca se almacena contraseña en texto plano.`,
      });
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Error cargando certificado.' });
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateDevTestCert = async () => {
    if (!canManageCert || !userProfile || activeDgiiConfig.environment !== 'DESARROLLO') return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/dgii/certificates/generate-dev-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: organization.id,
          rnc: activeDgiiConfig.rnc || '131000001',
          legalName: activeDgiiConfig.legalName || organization.name,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Error generando certificado de desarrollo.');
      }
      const meta = json.metadata;
      await saveDgiiCertificateMetadata({
        cert: {
          id: generateId('dgcert'),
          organizationId: organization.id,
          alias: 'Certificado Autofirmado SOLO DESARROLLO',
          subjectCn: meta.subjectCn,
          subjectRnc: meta.subjectRnc || activeDgiiConfig.rnc,
          issuerCn: meta.issuerCn,
          serialNumber: meta.serialNumber,
          fingerprintSha256: meta.fingerprintSha256,
          validFrom: meta.validFrom,
          validTo: meta.validTo,
          status: 'ACTIVO',
          vaultKeyId: meta.vaultKeyId,
          hasPrivateKey: true,
          uploadedBy: userProfile.uid,
          uploadedByName: userProfile.displayName,
          notes: 'Certificado autofirmado no acreditado por INDOTEL. Solo para pruebas locales en DESARROLLO.',
        },
        previousActiveCerts: dgiiCertificates,
        user: userProfile,
        environment: activeDgiiConfig.environment,
      });
      setFeedback({
        kind: 'ok',
        text: 'Certificado autofirmado de DESARROLLO generado para pruebas XMLDSig locales (no válido ante DGII).',
      });
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Error generando certificado DEV.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageConfig || !userProfile) return;
    const rncCheck = validateDominicanRnc(configDraft.rnc);
    if (!rncCheck.valid) {
      setFeedback({ kind: 'err', text: rncCheck.reason || 'RNC inválido.' });
      return;
    }
    if (configDraft.environment === 'PRODUCCION' && !configDraft.isCertifiedByDgii) {
      setFeedback({
        kind: 'err',
        text: 'No puede activar PRODUCCION sin confirmar que la entidad completó la certificación oficial ante DGII.',
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await saveDgiiFiscalConfig({
        config: {
          ...configDraft,
          rnc: rncCheck.normalized,
        },
        user: userProfile,
      });
      setFeedback({
        kind: 'ok',
        text: `Configuración fiscal DGII guardada (${configDraft.environment} · ${configDraft.enabledEcfTypes.length} tipos habilitados).`,
      });
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Error guardando configuración.' });
    } finally {
      setBusy(false);
    }
  };

  const handleTestDgiiAuth = async () => {
    if (!activeCert) {
      setFeedback({ kind: 'err', text: 'Cargue primero un certificado digital activo para probar autenticación.' });
      return;
    }
    setBusy(true);
    setSandboxAuthStatus('');
    try {
      const env = activeDgiiConfig.environment;
      const res = await fetch('/api/dgii/auth/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: organization.id,
          environment: env,
          endpoints: activeDgiiConfig.endpointsByEnv[env],
          vaultKeyId: activeCert.vaultKeyId,
          timeoutMs: activeDgiiConfig.timeoutMs,
          maxRetries: activeDgiiConfig.maxRetries,
        }),
      });
      const json = await res.json();
      setSandboxAuthStatus(
        json.ok
          ? `OK (${json.isOfficialDgiiResponse ? 'Token Oficial DGII' : 'Validación Local DESARROLLO'}): ${json.message}`
          : `Error: ${json.error}`
      );
    } catch (err) {
      setSandboxAuthStatus(`Error: ${err instanceof Error ? err.message : 'Fallo de red'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleTestServiceStatus = async () => {
    setBusy(true);
    setSandboxServiceStatus('');
    try {
      const url = activeDgiiConfig.endpointsByEnv[activeDgiiConfig.environment].serviceStatusUrl;
      const res = await fetch('/api/dgii/service-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceStatusUrl: url }),
      });
      const json = await res.json();
      setSandboxServiceStatus(
        `HTTP ${json.httpStatus || res.status} · ${json.message || JSON.stringify(json)}`
      );
    } catch (err) {
      setSandboxServiceStatus(`Error: ${err instanceof Error ? err.message : 'Sin conexión'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRunStructuralBattery = async () => {
    if (!userProfile) return;
    setBusy(true);
    setSandboxResults([]);
    const results: Array<{ ecfType: EcfTypeCode; xmlOk: boolean; signOk: boolean; details: string }> = [];
    const testRnc = validateDominicanRnc(activeDgiiConfig.rnc).valid ? activeDgiiConfig.rnc : '101000004';

    for (const code of activeDgiiConfig.enabledEcfTypes) {
      const sampleDoc: DgiiEcfDocumentRecord = {
        id: `test_${code}`,
        organizationId: organization.id,
        direction: 'EMITIDO',
        ecfType: code,
        eNCF: formatEncf(code, 1),
        status: 'BORRADOR',
        environment: activeDgiiConfig.environment,
        isOfficialDgiiResponse: false,
        isTestSimulation: true,
        issuerRnc: testRnc,
        issuerName: activeDgiiConfig.legalName || 'Entidad Emisora Prueba',
        issuerAddress: activeDgiiConfig.fiscalAddress || 'Santo Domingo, RD',
        receiverIdType: ECF_TYPE_META[code].requiresBuyerRnc ? 'RNC' : 'CEDULA',
        receiverTaxId: ECF_TYPE_META[code].requiresBuyerRnc ? '130000001' : '00100000002',
        receiverName: 'Receptor Set Pruebas',
        receiverAddress: 'Av. Abraham Lincoln, Santo Domingo',
        issueDate: new Date().toISOString().slice(0, 10),
        paymentCondition: 'CONTADO',
        paymentMethod: 'EFECTIVO',
        currency: 'DOP',
        exchangeRate: 1,
        items: [
          {
            lineNumber: 1,
            description: `Ítem Set de Pruebas e-CF ${code}`,
            itemType: 'SERVICIO',
            quantity: 1,
            unitOfMeasure: 'UND',
            unitPrice: 1000,
            discountAmount: 0,
            itbisRate: ECF_TYPE_META[code].allowsItbis ? 18 : 0,
            isExempt: !ECF_TYPE_META[code].allowsItbis,
            itbisAmount: ECF_TYPE_META[code].allowsItbis ? 180 : 0,
            otherTaxCode: 'NINGUNO',
            otherTaxRatePct: 0,
            otherTaxAmount: 0,
            lineSubtotal: 1000,
            lineTotal: ECF_TYPE_META[code].allowsItbis ? 1180 : 1000,
          },
        ],
        subtotal: 1000,
        totalDiscount: 0,
        exemptAmount: ECF_TYPE_META[code].allowsItbis ? 0 : 1000,
        taxableAmount18: ECF_TYPE_META[code].allowsItbis ? 1000 : 0,
        taxableAmount16: 0,
        totalItbis: ECF_TYPE_META[code].allowsItbis ? 180 : 0,
        otherTaxesTotal: 0,
        totalAmount: ECF_TYPE_META[code].allowsItbis ? 1180 : 1000,
        referenceEcf: code === '33' || code === '34' ? 'E310000000001' : undefined,
        referenceDate: code === '33' || code === '34' ? new Date().toISOString().slice(0, 10) : undefined,
        modificationCode: code === '33' ? '3' : code === '34' ? '1' : undefined,
        dgiiResponses: [],
        commercialApprovalStatus: 'NO_APLICA',
        paymentCollectionStatus: 'NO_APLICA',
        createdBy: userProfile.uid,
        createdByName: userProfile.displayName,
      };

      const xml = buildDgiiEcfXml({ document: sampleDoc, config: { ...activeDgiiConfig, rnc: testRnc } });
      const xsd = validateEcfBeforeDigitalSignature(xml, code);
      let signOk = false;
      let signNote = 'Sin certificado activo';

      if (activeCert) {
        try {
          const sRes = await fetch('/api/dgii/xml/sign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              organizationId: organization.id,
              vaultKeyId: activeCert.vaultKeyId,
              xml,
              expectedKind: xsd.schemaKind,
            }),
          });
          const sJson = await sRes.json();
          signOk = Boolean(sRes.ok && sJson.ok);
          signNote = signOk ? `Firma OK (${sJson.securityCode})` : sJson.error || 'Error de firma';
        } catch {
          signNote = 'Error invocando firmador';
        }
      }

      results.push({
        ecfType: code,
        xmlOk: xsd.valid,
        signOk,
        details: xsd.valid
          ? `${xsd.schemaFileName} OK (${xsd.checksExecuted.length} reglas) · ${signNote}`
          : xsd.errors.join('; '),
      });
    }

    setSandboxResults(results);
    await logDgiiCustomAuditEvent({
      organizationId: organization.id,
      eventType: 'SANDBOX_TEST_RUN',
      environment: activeDgiiConfig.environment,
      summary: `Batería estructural XML/XSD/Firma ejecutada sobre ${results.length} tipos e-CF habilitados.`,
      user: userProfile,
    });
    setBusy(false);
  };

  return (
    <div className="space-y-6 text-xs">
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

      {/* MODE 1: SEQUENCES */}
      {mode === 'sequences' && (
        <>
          <div className="space-y-1">
            <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <ListOrdered className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
              <span>Control de Secuencias e-NCF Autorizadas por DGII</span>
            </h2>
            <p className="text-slate-500 dark:text-slate-400">
              Asignación transaccional atómica libre de duplicidades. Cada rango autoriza secuencias únicas que nunca
              pueden reutilizarse tras emitirse.
            </p>
          </div>

          {canManageSeq && (
            <form
              onSubmit={handleCreateSequence}
              className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 grid grid-cols-1 sm:grid-cols-6 gap-3 items-end"
            >
              <div>
                <label className="block text-[11px] font-semibold mb-1">Tipo e-CF</label>
                <select
                  value={seqType}
                  onChange={(e) => setSeqType(e.target.value as EcfTypeCode)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                >
                  {ALL_ECF_TYPES.map((c) => (
                    <option key={c} value={c}>
                      {c} · {ECF_TYPE_META[c].shortName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">No. Autorización</label>
                <input
                  required
                  value={seqAuthNum}
                  onChange={(e) => setSeqAuthNum(e.target.value)}
                  placeholder="OFV-2026-001"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Fecha Autorización</label>
                <input
                  type="date"
                  value={seqAuthDate}
                  onChange={(e) => setSeqAuthDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Fecha Vencimiento</label>
                <input
                  type="date"
                  value={seqExpiryDate}
                  onChange={(e) => setSeqExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[11px] font-semibold mb-1">Desde</label>
                  <input
                    type="number"
                    min={1}
                    value={seqStart}
                    onChange={(e) => setSeqStart(Number(e.target.value))}
                    className="w-full px-2 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[11px] font-semibold mb-1">Hasta</label>
                  <input
                    type="number"
                    min={1}
                    value={seqEnd}
                    onChange={(e) => setSeqEnd(Number(e.target.value))}
                    className="w-full px-2 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Registrar Rango</span>
              </button>
            </form>
          )}

          <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase text-slate-500">
                    <th className="py-2.5 px-3">Tipo</th>
                    <th className="py-2.5 px-3">Autorización</th>
                    <th className="py-2.5 px-3">Rango e-NCF</th>
                    <th className="py-2.5 px-3">Última Usada</th>
                    <th className="py-2.5 px-3 text-right">Disponibles</th>
                    <th className="py-2.5 px-3">Vence</th>
                    <th className="py-2.5 px-3">Estado</th>
                    <th className="py-2.5 px-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {dgiiSequences.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        No hay rangos de secuencias e-NCF registrados. Registre al menos un rango para emitir.
                      </td>
                    </tr>
                  ) : (
                    dgiiSequences.map((s) => {
                      const available = Math.max(0, s.endSequence - s.lastUsedSequence);
                      return (
                        <tr key={s.id} className="border-b border-slate-100 dark:border-white/5">
                          <td className="py-2.5 px-3 font-semibold">{ECF_TYPE_META[s.ecfType].shortName}</td>
                          <td className="py-2.5 px-3 font-mono">{s.authorizationNumber}</td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            {formatEncf(s.ecfType, s.startSequence)} → {formatEncf(s.ecfType, s.endSequence)}
                          </td>
                          <td className="py-2.5 px-3 font-mono">
                            {s.lastUsedSequence >= s.startSequence
                              ? formatEncf(s.ecfType, s.lastUsedSequence)
                              : 'Sin uso'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">
                            {available.toLocaleString('es-DO')}
                          </td>
                          <td className="py-2.5 px-3 font-mono">{s.expiryDate}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-white/10">
                              {s.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {canManageSeq && s.status !== 'AGOTADA' && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleSequenceStatus(s, s.status === 'ACTIVA' ? 'SUSPENDIDA' : 'ACTIVA')
                                }
                                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/10 font-semibold cursor-pointer"
                              >
                                {s.status === 'ACTIVA' ? 'Suspender' : 'Reactivar'}
                              </button>
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
        </>
      )}

      {/* MODE 2: CERTIFICATES */}
      {mode === 'certificates' && (
        <>
          <div className="space-y-1">
            <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
              <span>Administrador de Certificados Digitales (.p12 / .pfx)</span>
            </h2>
            <p className="text-slate-500 dark:text-slate-400">
              Bóveda cifrada AES-256-GCM en servidor. Las contraseñas y llaves privadas nunca se guardan en texto plano,
              código fuente, Firestore ni logs de auditoría.
            </p>
          </div>

          {certRows.some((c) => c.status === 'POR_VENCER' || (c.status === 'ACTIVO' && c.daysLeft <= 30)) && (
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Alerta de vigencia: Tiene un certificado próximo a vencer en menos de 30 días.</span>
            </div>
          )}

          {canManageCert && (
            <form
              onSubmit={handleUploadCertificate}
              className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Alias Identificador</label>
                  <input
                    value={certAlias}
                    onChange={(e) => setCertAlias(e.target.value)}
                    placeholder="Ej. Certificado Firma DGII 2026"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Archivo PKCS#12 (.p12 / .pfx)</label>
                  <label className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-white/15 bg-slate-50 dark:bg-[#040C1E] cursor-pointer font-semibold">
                    <Upload className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
                    <span className="truncate">{certFileName || 'Seleccionar .p12/.pfx'}</span>
                    <input type="file" accept=".p12,.pfx" onChange={handleSelectP12File} className="hidden" />
                  </label>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1">Contraseña del Certificado</label>
                  <input
                    type="password"
                    required
                    value={certPassword}
                    onChange={(e) => setCertPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy || !certFileBase64}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Cargar y Cifrar en Bóveda</span>
                </button>
              </div>

              {activeDgiiConfig.environment === 'DESARROLLO' && (
                <div className="pt-2 border-t border-slate-100 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Para pruebas técnicas locales en ambiente DESARROLLO únicamente (no válido ante INDOTEL/DGII):
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleGenerateDevTestCert}
                    className="px-3.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 font-semibold cursor-pointer"
                  >
                    Generar Certificado de Prueba Local (Solo Desarrollo)
                  </button>
                </div>
              )}
            </form>
          )}

          <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase text-slate-500">
                    <th className="py-2.5 px-3">Alias</th>
                    <th className="py-2.5 px-3">Titular (CN)</th>
                    <th className="py-2.5 px-3">Emisor</th>
                    <th className="py-2.5 px-3">Vigencia</th>
                    <th className="py-2.5 px-3">Días Rest.</th>
                    <th className="py-2.5 px-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {certRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        Sin certificados digitales registrados para esta organización.
                      </td>
                    </tr>
                  ) : (
                    certRows.map((c) => (
                      <tr key={c.id} className="border-b border-slate-100 dark:border-white/5">
                        <td className="py-2.5 px-3 font-semibold">{c.alias}</td>
                        <td className="py-2.5 px-3">{c.subjectCn}</td>
                        <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">{c.issuerCn}</td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          {c.validFrom.slice(0, 10)} → {c.validTo.slice(0, 10)}
                        </td>
                        <td className="py-2.5 px-3 font-mono">{c.daysLeft}d</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-white/10">
                            {c.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* MODE 3: DGII CONFIG */}
      {mode === 'config' && (
        <form onSubmit={handleSaveConfig} className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
                <span>Configuración Fiscal y Endpoints Oficiales DGII</span>
              </h2>
              <p className="text-slate-500 dark:text-slate-400">
                Configuración tributaria aislada por empresa ({organization.tradeName || organization.name}), URLs por
                ambiente, comprobantes habilitados y cuentas contables automáticas.
              </p>
            </div>
            {canManageConfig && (
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>Guardar Configuración DGII</span>
              </button>
            )}
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold mb-1">RNC Emisor (9 dígitos)</label>
              <input
                required
                value={configDraft.rnc}
                onChange={(e) => setConfigDraft((p) => ({ ...p, rnc: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold mb-1">Razón Social</label>
              <input
                required
                value={configDraft.legalName}
                onChange={(e) => setConfigDraft((p) => ({ ...p, legalName: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold mb-1">Ambiente DGII Activo</label>
              <select
                value={configDraft.environment}
                onChange={(e) => setConfigDraft((p) => ({ ...p, environment: e.target.value as DgiiEnvironment }))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-semibold"
              >
                <option value="DESARROLLO">DESARROLLO (Pruebas locales)</option>
                <option value="PRECERTIFICACION">PRECERTIFICACION (testeCF DGII)</option>
                <option value="CERTIFICACION">CERTIFICACION (certeCF DGII)</option>
                <option value="PRODUCCION">PRODUCCION (eCF Oficial DGII)</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-[11px] font-semibold mb-1">Dirección Fiscal</label>
              <input
                required
                value={configDraft.fiscalAddress}
                onChange={(e) => setConfigDraft((p) => ({ ...p, fiscalAddress: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold mb-1">Tipo Contribuyente</label>
              <select
                value={configDraft.taxpayerType}
                onChange={(e) =>
                  setConfigDraft((p) => ({ ...p, taxpayerType: e.target.value as DgiiFiscalConfigRecord['taxpayerType'] }))
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
              >
                <option value="PERSONA_JURIDICA">Persona Jurídica</option>
                <option value="PERSONA_FISICA">Persona Física</option>
                <option value="GRAN_CONTRIBUYENTE">Gran Contribuyente</option>
                <option value="REGIMEN_ESPECIAL">Régimen Especial</option>
                <option value="GUBERNAMENTAL">Gubernamental</option>
              </select>
            </div>
            <div className="md:col-span-3 flex flex-wrap items-center gap-4 pt-1">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={configDraft.isCertifiedByDgii}
                  onChange={(e) => setConfigDraft((p) => ({ ...p, isCertifiedByDgii: e.target.checked }))}
                />
                <span className="font-semibold">
                  Entidad oficialmente certificada como Emisor Electrónico por la DGII (habilita Producción)
                </span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={configDraft.autoPostAccounting}
                  onChange={(e) => setConfigDraft((p) => ({ ...p, autoPostAccounting: e.target.checked }))}
                />
                <span className="font-semibold">Contabilización Automática en Libro Diario</span>
              </label>
            </div>
          </div>

          {/* Entitlements */}
          <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-2.5">
            <h3 className="font-semibold text-slate-950 dark:text-white">
              Tipos de Comprobantes Electrónicos Habilitados para la Entidad
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              {ALL_ECF_TYPES.map((code) => {
                const checked = configDraft.enabledEcfTypes.includes(code);
                return (
                  <label
                    key={code}
                    className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer ${
                      checked
                        ? 'border-[#0066FF] bg-[#0066FF]/5 dark:bg-[#00B8FF]/10'
                        : 'border-slate-200 dark:border-white/10'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...configDraft.enabledEcfTypes, code]
                          : configDraft.enabledEcfTypes.filter((c) => c !== code);
                        setConfigDraft((p) => ({ ...p, enabledEcfTypes: next }));
                      }}
                    />
                    <span className="font-semibold">{ECF_TYPE_META[code].shortName}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Endpoints for Selected Environment */}
          <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-950 dark:text-white">
                Endpoints Oficiales DGII ({configDraft.environment})
              </h3>
              <button
                type="button"
                onClick={() =>
                  setConfigDraft((p) => ({
                    ...p,
                    endpointsByEnv: {
                      ...p.endpointsByEnv,
                      [p.environment]: { ...OFFICIAL_DGII_ENV_ENDPOINTS[p.environment] },
                    },
                  }))
                }
                className="px-3 py-1 rounded-lg border border-slate-200 dark:border-white/15 font-semibold cursor-pointer"
              >
                Restaurar URLs Oficiales DGII
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(
                [
                  ['authSeedUrl', 'Autenticación (Semilla)'],
                  ['authValidateUrl', 'Autenticación (Validar Semilla)'],
                  ['receptionUrl', 'Recepción e-CF'],
                  ['receptionFcUrl', 'Recepción Factura Consumo (RFCE < 250k)'],
                  ['trackResultUrl', 'Consulta de Estado / TrackId'],
                  ['commercialApprovalUrl', 'Aprobación Comercial (ACECF)'],
                  ['voidRangeUrl', 'Anulación de Secuencias (ANECF)'],
                  ['serviceStatusUrl', 'Estatus de Servicios DGII'],
                ] as const
              ).map(([field, label]) => (
                <div key={field}>
                  <label className="block text-[11px] font-semibold mb-1">{label}</label>
                  <input
                    value={configDraft.endpointsByEnv[configDraft.environment][field]}
                    onChange={(e) => {
                      const val = e.target.value;
                      setConfigDraft((p) => ({
                        ...p,
                        endpointsByEnv: {
                          ...p.endpointsByEnv,
                          [p.environment]: {
                            ...p.endpointsByEnv[p.environment],
                            [field]: val,
                          },
                        },
                      }));
                    }}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono text-[11px]"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Account Mapping */}
          <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3">
            <h3 className="font-semibold text-slate-950 dark:text-white">
              Mapeo de Cuentas Contables para Asientos Automáticos
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(
                [
                  ['receivablesAccountCode', 'Cuentas por Cobrar Clientes'],
                  ['cashOrBankAccountCode', 'Bancos / Caja General'],
                  ['salesRevenueAccountCode', 'Ingresos Ventas / Servicios'],
                  ['itbisPayableAccountCode', 'ITBIS por Pagar (607)'],
                  ['itbisCreditableAccountCode', 'ITBIS Adelantado (606)'],
                  ['payablesAccountCode', 'Cuentas por Pagar Proveedores'],
                  ['purchasesExpenseAccountCode', 'Compras / Costos y Gastos'],
                  ['creditNoteReturnsAccountCode', 'Devoluciones / Notas Crédito'],
                  ['minorExpensesAccountCode', 'Gastos Menores (e-CF 43)'],
                ] as const
              ).map(([field, label]) => (
                <div key={field}>
                  <label className="block text-[11px] font-semibold mb-1">{label}</label>
                  <select
                    value={configDraft.accountMapping[field]}
                    onChange={(e) =>
                      setConfigDraft((p) => ({
                        ...p,
                        accountMapping: { ...p.accountMapping, [field]: e.target.value },
                      }))
                    }
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                  >
                    <option value={configDraft.accountMapping[field]}>
                      {configDraft.accountMapping[field]} (Actual)
                    </option>
                    {postableAccounts.map((a) => (
                      <option key={a.id} value={a.code}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </form>
      )}

      {/* MODE 4: SANDBOX / AMBIENTE DE PRUEBAS */}
      {mode === 'sandbox' && (
        <div className="space-y-5">
          <div className="space-y-1">
            <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
              <span>Ambiente de Pruebas, Precertificación y Set de Certificación DGII</span>
            </h2>
            <p className="text-slate-500 dark:text-slate-400">
              Ambiente actual: <strong>{activeDgiiConfig.environment}</strong>. Ejecute diagnósticos de semilla/token,
              verifique disponibilidad de endpoints oficiales y valide estructura XSD + firma XMLDSig de cada tipo e-CF.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-200 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>
              <strong>Transparencia Fiscal:</strong> Las pruebas en <code>DESARROLLO</code> validan generación XML,
              XSD y firma criptográfica XMLDSig localmente. Para respuestas oficiales de la DGII, configure su
              certificado acreditado por INDOTEL y cambie a <code>PRECERTIFICACION</code> (testeCF) o{' '}
              <code>CERTIFICACION</code> (certeCF).
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3">
              <h3 className="font-semibold">1. Autenticación Semilla DGII</h3>
              <p className="text-slate-500 dark:text-slate-400">
                Solicita semilla, firma XML con certificado en bóveda e intercambia por token JWT en{' '}
                {activeDgiiConfig.environment}.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={handleTestDgiiAuth}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Probar Autenticación DGII</span>
              </button>
              {sandboxAuthStatus && (
                <p className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#040C1E] font-mono text-[11px]">{sandboxAuthStatus}</p>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3">
              <h3 className="font-semibold">2. Estatus Servicios DGII</h3>
              <p className="text-slate-500 dark:text-slate-400">
                Consulta en vivo la disponibilidad de los servicios de facturación electrónica publicados por DGII.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={handleTestServiceStatus}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/15 font-semibold cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Consultar Estatus Oficial</span>
              </button>
              {sandboxServiceStatus && (
                <p className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#040C1E] font-mono text-[11px]">
                  {sandboxServiceStatus}
                </p>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 space-y-3">
              <h3 className="font-semibold">3. Batería Estructural XML + XMLDSig</h3>
              <p className="text-slate-500 dark:text-slate-400">
                Construye, valida contra reglas XSD y firma XMLDSig cada tipo de comprobante habilitado (31..47).
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={handleRunStructuralBattery}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0B1F3A] text-white border border-[#00B8FF]/30 font-semibold cursor-pointer disabled:opacity-50"
              >
                <FlaskConical className="w-4 h-4 text-[#00B8FF]" />
                <span>Ejecutar Batería Set de Pruebas</span>
              </button>
            </div>
          </div>

          {sandboxResults.length > 0 && (
            <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase text-slate-500">
                    <th className="py-2.5 px-3">Tipo e-CF</th>
                    <th className="py-2.5 px-3">Validación XSD</th>
                    <th className="py-2.5 px-3">Firma XMLDSig</th>
                    <th className="py-2.5 px-3">Detalle Técnico</th>
                  </tr>
                </thead>
                <tbody>
                  {sandboxResults.map((r) => (
                    <tr key={r.ecfType} className="border-b border-slate-100 dark:border-white/5">
                      <td className="py-2.5 px-3 font-semibold">{ECF_TYPE_META[r.ecfType].name}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 font-bold ${
                            r.xmlOk ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{r.xmlOk ? 'Válido' : 'Error'}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={r.signOk ? 'text-emerald-600 font-bold' : 'text-amber-600'}>
                          {r.signOk ? 'Firmado' : 'Pendiente cert.'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">{r.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Loaded Official DGII XSD Registry */}
          <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden">
            <div className="p-3.5 border-b border-slate-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white">
                  Esquemas XSD Oficiales DGII Cargados (Ley 32-23 · v1.0)
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Compilados por el validador pre-firma para los 10 tipos e-CF y 4 formatos complementarios (RFCE, ACECF, ARECF, ANECF).
                </p>
              </div>
              <span className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                {loadedXsdSchemas.length} esquemas activos
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase text-slate-500">
                    <th className="py-2 px-3">Archivo XSD</th>
                    <th className="py-2 px-3">Raíz XML</th>
                    <th className="py-2 px-3">Descripción Normativa</th>
                    <th className="py-2 px-3 text-right">Nodos / Tipos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {loadedXsdSchemas.map((s) => (
                    <tr key={s.kind}>
                      <td className="py-2 px-3 font-mono font-semibold text-[#0052CC] dark:text-[#00D1FF]">
                        {s.fileName}
                      </td>
                      <td className="py-2 px-3 font-mono">&lt;{s.rootElement}&gt;</td>
                      <td className="py-2 px-3">{s.title}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        {s.elementDefinitions} elem · {s.simpleTypeCount} tipos
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type DgiiInfraSeqItem = ReturnType<typeof useAxyCore>['dgiiSequences'][number];
