import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  FileText,
  Globe,
  Link2,
  Lock,
  RefreshCw,
  Save,
  Search,
  Share2,
  Sparkles,
  UserCheck,
  X,
} from 'lucide-react';
import {
  buildExternalPortalShareMessage,
  buildInstitutionExternalPortalLinks,
  buildPublicPortalRecordFromOrg,
  generateUniquePortalCodeForOrg,
  normalizePortalCode,
} from '../engine/externalPortalEngine';
import { PublicCreditApplicationForm } from './PublicCreditApplicationForm';
import {
  fetchAllPublicPortalsForOrgs,
  syncPublicInstitutionPortal,
  updateInstitutionPortalCodeAndSync,
} from '../services/externalPortalService';
import type { OrganizationRecord, PublicInstitutionPortalRecord } from '../types/axycore';
import { formatUserFacingError } from '../utils/formatters';

interface ExternalLinkGeneratorPanelProps {
  /** All registered institutions (Superadmin passes allOrganizations; Institution Admin passes [organization]) */
  institutions: OrganizationRecord[];
  /** Default selected institution ID */
  initialInstitutionId?: string;
  /** Whether user has permission to edit/publish external portal links */
  canEdit: boolean;
  /** Optional compact title override */
  title?: string;
  /** Optional subtitle override */
  subtitle?: string;
}

export function ExternalLinkGeneratorPanel({
  institutions,
  initialInstitutionId,
  canEdit,
  title = 'Generador de Enlaces Externos por Institución',
  subtitle = 'Genera, personaliza y publica enlaces únicos aislados por institución para el formulario público de solicitud de crédito y el portal de acceso de clientes.',
}: ExternalLinkGeneratorPanelProps) {
  const isMultiInstitution = institutions.length > 1;
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrgId, setSelectedOrgId] = useState<string>(
    () => initialInstitutionId || institutions[0]?.id || ''
  );

  // Published portal directory cache per organizationId
  const [publishedMap, setPublishedMap] = useState<
    Record<string, PublicInstitutionPortalRecord | null>
  >({});
  const [loadingPortals, setLoadingPortals] = useState(false);

  // Editable form state for the selected institution
  const [portalCodeDraft, setPortalCodeDraft] = useState('');
  const [portalEnabledDraft, setPortalEnabledDraft] = useState(true);
  const [headlineDraft, setHeadlineDraft] = useState('');
  const [subtitleDraft, setSubtitleDraft] = useState('');

  const [saving, setSaving] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<'solicitud' | 'login'>('solicitud');

  // Keep selectedOrgId valid when institutions change
  useEffect(() => {
    if (!institutions.length) return;
    if (!institutions.some((o) => o.id === selectedOrgId)) {
      setSelectedOrgId(initialInstitutionId || institutions[0].id);
    }
  }, [institutions, initialInstitutionId, selectedOrgId]);

  const selectedOrg = useMemo(
    () => institutions.find((o) => o.id === selectedOrgId) || institutions[0] || null,
    [institutions, selectedOrgId]
  );

  // Fetch published portal status for all visible institutions
  const refreshPublishedStatuses = async () => {
    if (!institutions.length) return;
    setLoadingPortals(true);
    try {
      const map = await fetchAllPublicPortalsForOrgs(institutions);
      setPublishedMap(map);
    } finally {
      setLoadingPortals(false);
    }
  };

  useEffect(() => {
    void refreshPublishedStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutions.map((o) => `${o.id}:${o.accessCode || ''}`).join('|')]);

  // Populate editor fields when selectedOrg or its published record changes
  useEffect(() => {
    if (!selectedOrg) return;
    const published = publishedMap[selectedOrg.id];
    const currentCode =
      published?.portalCode ||
      normalizePortalCode(selectedOrg.accessCode || selectedOrg.tenantId || selectedOrg.id) ||
      'INST-001';
    setPortalCodeDraft(currentCode);
    setPortalEnabledDraft(published ? published.portalEnabled !== false : true);
    setHeadlineDraft(
      published?.welcomeHeadline ||
        `Portal de Clientes y Solicitudes — ${selectedOrg.tradeName || selectedOrg.name}`
    );
    setSubtitleDraft(
      published?.welcomeSubtitle ||
        'Completa tu solicitud de crédito en línea sin crear cuenta, o inicia sesión para consultar tus préstamos, cuotas y saldos.'
    );
    setFeedback(null);
  }, [selectedOrg, publishedMap]);

  const filteredInstitutions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return institutions;
    return institutions.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.tradeName || '').toLowerCase().includes(q) ||
        (o.accessCode || '').toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q)
    );
  }, [institutions, searchTerm]);

  const activePreviewOrg = useMemo(() => {
    if (!selectedOrg) return null;
    const cleanCode =
      normalizePortalCode(portalCodeDraft) ||
      normalizePortalCode(selectedOrg.accessCode || selectedOrg.tenantId || selectedOrg.id);
    return {
      ...selectedOrg,
      accessCode: cleanCode,
    };
  }, [selectedOrg, portalCodeDraft]);

  const generatedLinks = useMemo(() => {
    if (!activePreviewOrg) return null;
    const base = buildInstitutionExternalPortalLinks(activePreviewOrg);
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin.replace(/\/+$/, '')
        : 'https://axycore.app';
    const encoded = encodeURIComponent(base.portalCode);
    return {
      ...base,
      clientLoginUrl: `${origin}/?portal=${encoded}&action=ingresar`,
      prettyPathUrl: `${origin}/portal/${encoded}`,
    };
  }, [activePreviewOrg]);

  const copyWithFeedback = async (key: string, text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setFeedback({ type: 'ok', msg: `${label} copiado al portapapeles.` });
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2400);
    } catch {
      setFeedback({
        type: 'err',
        msg: 'No pudimos acceder al portapapeles. Selecciona y copia el enlace manualmente.',
      });
    }
  };

  const handleGenerateUniqueCode = () => {
    if (!selectedOrg) return;
    const existingCodes = institutions
      .filter((o) => o.id !== selectedOrg.id)
      .map((o) => publishedMap[o.id]?.portalCode || o.accessCode || o.tenantId || o.id);
    const nextCode = generateUniquePortalCodeForOrg(
      selectedOrg.tradeName || selectedOrg.name,
      existingCodes
    );
    setPortalCodeDraft(nextCode);
    setFeedback({
      type: 'ok',
      msg: `Código único sugerido: ${nextCode}. Presiona "Guardar y Publicar Enlace" para activarlo en la base de datos.`,
    });
  };

  const handlePublishSelected = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrg || !canEdit) return;
    const cleanCode = normalizePortalCode(portalCodeDraft);
    if (!cleanCode || cleanCode.length < 3) {
      setFeedback({
        type: 'err',
        msg: 'El código único del enlace debe tener al menos 3 caracteres (letras, números o guiones).',
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const published = await updateInstitutionPortalCodeAndSync({
        org: selectedOrg,
        newPortalCode: cleanCode,
        portalEnabled: portalEnabledDraft,
        welcomeHeadline: headlineDraft,
        welcomeSubtitle: subtitleDraft,
      });
      setPublishedMap((prev) => ({ ...prev, [selectedOrg.id]: published }));
      setPortalCodeDraft(published.portalCode);
      setFeedback({
        type: 'ok',
        msg: portalEnabledDraft
          ? `Enlace externo ${published.portalCode} publicado y activo para ${selectedOrg.tradeName || selectedOrg.name}. El formulario público de crédito y login de clientes ya están habilitados.`
          : `Portal externo ${published.portalCode} guardado en estado pausado. Las solicitudes públicas y el acceso externo quedaron bloqueados.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: formatUserFacingError(err, 'No se pudo publicar el enlace externo de esta institución.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSyncAllInstitutions = async () => {
    if (!canEdit || !institutions.length) return;
    setSyncingAll(true);
    setFeedback(null);
    try {
      const updatedEntries: Record<string, PublicInstitutionPortalRecord | null> = { ...publishedMap };
      let syncedCount = 0;
      for (const org of institutions) {
        const existing = publishedMap[org.id];
        const published = await syncPublicInstitutionPortal(org, {
          portalEnabled: existing ? existing.portalEnabled : org.status === 'ACTIVA',
          welcomeHeadline: existing?.welcomeHeadline,
          welcomeSubtitle: existing?.welcomeSubtitle,
        });
        updatedEntries[org.id] = published;
        syncedCount += 1;
      }
      setPublishedMap(updatedEntries);
      setFeedback({
        type: 'ok',
        msg: `Se sincronizaron y publicaron ${syncedCount} portales externos únicos en Firestore con aislamiento estricto por institución.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: formatUserFacingError(err, 'Error al sincronizar los enlaces externos de las instituciones.'),
      });
    } finally {
      setSyncingAll(false);
    }
  };

  const handleOpenLiveInTab = (url: string) => {
    if (typeof window === 'undefined') return;
    // Safe navigation in same browsing context (no window.open)
    window.location.assign(url);
  };

  if (!selectedOrg || !generatedLinks) {
    return (
      <div className="axy-surface rounded-2xl p-8 text-center text-xs text-slate-500 dark:text-slate-400">
        No hay instituciones registradas disponibles para generar enlaces externos.
      </div>
    );
  }

  const publishedRecord = publishedMap[selectedOrg.id];
  const isPublishedAndActive = Boolean(
    publishedRecord && publishedRecord.portalEnabled && publishedRecord.status === 'ACTIVA'
  );
  const instPrimary = selectedOrg.primaryColor || '#0f3d91';
  const instAccent = selectedOrg.accentColor || '#0284c7';

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-200/80 dark:border-[#00B8FF]/15">
        <div className="space-y-1">
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#0066FF] dark:text-[#00D1FF]" />
            <span>{title}</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-3xl leading-relaxed">
            {subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isMultiInstitution && canEdit && (
            <button
              type="button"
              disabled={syncingAll}
              onClick={handleSyncAllInstitutions}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-[#00B8FF]/25 bg-white dark:bg-[#08132B] hover:border-[#0066FF] text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingAll ? 'animate-spin' : ''}`} />
              <span>{syncingAll ? 'Sincronizando...' : `Publicar Todas (${institutions.length})`}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Vista Previa</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-start justify-between gap-3 ${
            feedback.type === 'ok'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-200'
          }`}
        >
          <div className="flex items-start gap-2">
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
            )}
            <span>{feedback.msg}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className={`grid grid-cols-1 ${isMultiInstitution ? 'xl:grid-cols-12' : ''} gap-5`}>
        {/* Left Directory (Multi-Institution Superadmin Selector) */}
        {isMultiInstitution && (
          <div className="xl:col-span-4 axy-surface rounded-2xl border border-slate-200/80 dark:border-[#00B8FF]/18 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200/80 dark:border-[#00B8FF]/15 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  Instituciones Registradas ({institutions.length})
                </span>
                {loadingPortals && (
                  <RefreshCw className="w-3.5 h-3.5 text-slate-400 animate-spin" />
                )}
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar institución o código..."
                  className="axy-input w-full pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="divide-y divide-slate-200/70 dark:divide-white/[0.06] max-h-[540px] overflow-y-auto">
              {filteredInstitutions.map((org) => {
                const pub = publishedMap[org.id];
                const code =
                  pub?.portalCode ||
                  normalizePortalCode(org.accessCode || org.tenantId || org.id);
                const selected = org.id === selectedOrg.id;
                const activePortal = Boolean(pub && pub.portalEnabled && pub.status === 'ACTIVA');
                return (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => setSelectedOrgId(org.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors cursor-pointer flex items-start justify-between gap-3 ${
                      selected
                        ? 'bg-[#0066FF]/10 dark:bg-[#0066FF]/18'
                        : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {org.tradeName || org.name}
                      </p>
                      <p className="text-[11px] font-mono text-[#0052CC] dark:text-[#00D1FF]">
                        {code}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {org.currency || 'DOP'} · {org.city || org.country || 'República Dominicana'}
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-semibold shrink-0 ${
                        activePortal
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : pub
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {activePortal ? 'Activo' : pub ? 'Pausado' : 'Sin publicar'}
                    </span>
                  </button>
                );
              })}
              {filteredInstitutions.length === 0 && (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  Ninguna institución coincide con "{searchTerm}".
                </div>
              )}
            </div>
          </div>
        )}

        {/* Right Panel: Selected Institution Generator & 3 Unique Links */}
        <div className={`${isMultiInstitution ? 'xl:col-span-8' : ''} space-y-5`}>
          {/* Institution Identity & Isolation Summary */}
          <div className="axy-surface rounded-2xl border border-slate-200/80 dark:border-[#00B8FF]/18 p-5 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200/80 dark:border-[#00B8FF]/15">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-display font-bold text-sm shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${instPrimary}, ${instAccent})`,
                  }}
                >
                  {(selectedOrg.tradeName || selectedOrg.name).slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white truncate">
                    {selectedOrg.tradeName || selectedOrg.name}
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                    ID Aislado: {selectedOrg.id} · Moneda: {selectedOrg.currency || 'DOP'}
                  </p>
                </div>
              </div>

              <div className="text-right text-xs">
                <span
                  className={`font-semibold block ${
                    isPublishedAndActive
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : publishedRecord
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {isPublishedAndActive
                    ? 'Enlace Externo Publicado y Activo'
                    : publishedRecord
                    ? 'Enlace Publicado (Pausado)'
                    : 'Pendiente de Publicación en Firestore'}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-1 justify-end mt-0.5">
                  <Lock className="w-3 h-3 text-emerald-500" />
                  Aislamiento multi-tenant por institución
                </span>
              </div>
            </div>

            {/* Generated Unique Links Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {[
                {
                  key: `apply_${selectedOrg.id}`,
                  icon: FileText,
                  title: 'Formulario Público de Crédito',
                  desc: 'Solicitud de crédito directa sin login. Se recibe exclusivamente en esta institución.',
                  url: generatedLinks.creditApplicationUrl,
                },
                {
                  key: `login_${selectedOrg.id}`,
                  icon: UserCheck,
                  title: 'Login de Clientes (Préstamos y Cuotas)',
                  desc: 'Ingreso y registro para que tus clientes validen sus préstamos, cuotas y montos.',
                  url: generatedLinks.clientLoginUrl,
                },
                {
                  key: `main_${selectedOrg.id}`,
                  icon: Link2,
                  title: 'Portal Unificado de la Institución',
                  desc: 'Enlace principal con ambos módulos: solicitud pública y acceso de clientes.',
                  url: generatedLinks.portalUrl,
                },
              ].map((linkItem) => {
                const Icon = linkItem.icon;
                const isCopied = copiedKey === linkItem.key;
                return (
                  <div
                    key={linkItem.key}
                    className="p-4 rounded-xl bg-slate-50/90 dark:bg-[#040C1E]/85 border border-slate-200/85 dark:border-[#00B8FF]/18 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1.5">
                      <p className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF] shrink-0" />
                        <span>{linkItem.title}</span>
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        {linkItem.desc}
                      </p>
                      <p className="font-mono text-[11px] text-[#0052CC] dark:text-[#00D1FF] break-all pt-1">
                        {linkItem.url}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => copyWithFeedback(linkItem.key, linkItem.url, linkItem.title)}
                        className="flex-1 py-2 px-2.5 rounded-lg border border-slate-200 dark:border-[#00B8FF]/25 bg-white dark:bg-[#08132B] hover:border-[#0066FF] text-slate-800 dark:text-slate-100 text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copiar URL</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        title="Probar enlace en esta ventana"
                        onClick={() => handleOpenLiveInTab(linkItem.url)}
                        className="py-2 px-2.5 rounded-lg border border-slate-200 dark:border-white/15 bg-white dark:bg-[#08132B] hover:border-[#0066FF] text-slate-600 dark:text-slate-300 hover:text-[#0066FF] dark:hover:text-[#00D1FF] text-[11px] font-semibold cursor-pointer transition-colors whitespace-nowrap"
                      >
                        Probar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Share Kit Row */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200/70 dark:border-white/[0.08] text-xs">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Ruta corta alternativa:{' '}
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {generatedLinks.prettyPathUrl}
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  copyWithFeedback(
                    `share_${selectedOrg.id}`,
                    buildExternalPortalShareMessage(
                      selectedOrg.tradeName || selectedOrg.name,
                      generatedLinks
                    ),
                    'Mensaje para compartir'
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#00B8FF]/25 bg-white dark:bg-[#08132B] hover:border-[#0066FF] text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer transition-colors whitespace-nowrap"
              >
                <Share2 className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
                <span>Copiar Mensaje para WhatsApp / Correo</span>
              </button>
            </div>

            {/* Configuration & Publishing Form */}
            {canEdit && (
              <form
                onSubmit={handlePublishSelected}
                className="pt-4 border-t border-slate-200/80 dark:border-[#00B8FF]/15 space-y-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end">
                  <div className="md:col-span-5">
                    <label
                      htmlFor="gen-portal-code"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Código único del enlace institucional *
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="gen-portal-code"
                        type="text"
                        required
                        maxLength={40}
                        value={portalCodeDraft}
                        onChange={(e) => setPortalCodeDraft(normalizePortalCode(e.target.value))}
                        placeholder="Ej. SGMA-001"
                        className="axy-input flex-1 px-3 py-2 font-mono text-xs text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={handleGenerateUniqueCode}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-[#00B8FF]/25 bg-white dark:bg-[#08132B] hover:border-[#0066FF] text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00D1FF]" />
                        <span>Generar Código</span>
                      </button>
                    </div>
                  </div>

                  <div className="md:col-span-7">
                    <label
                      htmlFor="gen-headline"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Título de bienvenida en el enlace externo
                    </label>
                    <input
                      id="gen-headline"
                      type="text"
                      maxLength={160}
                      value={headlineDraft}
                      onChange={(e) => setHeadlineDraft(e.target.value)}
                      placeholder={`Portal de Clientes — ${selectedOrg.tradeName || selectedOrg.name}`}
                      className="axy-input w-full px-3 py-2 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end">
                  <div className="md:col-span-8">
                    <label
                      htmlFor="gen-subtitle"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Mensaje descriptivo para clientes
                    </label>
                    <input
                      id="gen-subtitle"
                      type="text"
                      maxLength={360}
                      value={subtitleDraft}
                      onChange={(e) => setSubtitleDraft(e.target.value)}
                      placeholder="Completa tu solicitud de crédito en línea o inicia sesión para consultar tus préstamos y cuotas."
                      className="axy-input w-full px-3 py-2 text-xs text-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="md:col-span-4 flex flex-col gap-2">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={portalEnabledDraft}
                        onChange={(e) => setPortalEnabledDraft(e.target.checked)}
                        className="rounded border-slate-300 text-[#0066FF]"
                      />
                      <span>Habilitar solicitudes públicas y acceso de clientes</span>
                    </label>
                    <button
                      type="submit"
                      disabled={saving}
                      className="axy-btn-primary w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{saving ? 'Publicando...' : 'Guardar y Publicar Enlace'}</span>
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Inline In-App Preview Modal (No window.open) */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[#050C1F] border border-white/15 text-slate-100 shadow-2xl overflow-hidden">
            <div
              className="h-1.5 w-full shrink-0"
              style={{
                background: `linear-gradient(90deg, ${instPrimary}, ${instAccent})`,
              }}
            />
            <div className="p-5 border-b border-white/10 flex items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="h-9 w-9 rounded-xl flex items-center justify-center text-white font-display font-bold text-xs shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${instPrimary}, ${instAccent})`,
                  }}
                >
                  {(selectedOrg.tradeName || selectedOrg.name).slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">
                    Vista Previa: {selectedOrg.tradeName || selectedOrg.name}
                  </p>
                  <p className="text-[11px] font-mono text-slate-400 truncate">
                    {generatedLinks.portalUrl}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto">
              <div className="space-y-1.5">
                <p
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: instAccent }}
                >
                  Portal Oficial · Código {generatedLinks.portalCode}
                </p>
                <h4 className="font-display text-xl font-bold text-white">
                  {headlineDraft || `Portal de Clientes — ${selectedOrg.tradeName || selectedOrg.name}`}
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">{subtitleDraft}</p>
              </div>

              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#030816] border border-white/10">
                <button
                  type="button"
                  onClick={() => setPreviewMode('solicitud')}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                    previewMode === 'solicitud' ? 'text-white' : 'text-slate-400 hover:text-white'
                  }`}
                  style={
                    previewMode === 'solicitud'
                      ? { background: `linear-gradient(135deg, ${instPrimary}, ${instAccent})` }
                      : undefined
                  }
                >
                  Formulario Público de Crédito (5 Pasos)
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('login')}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                    previewMode === 'login' ? 'text-white' : 'text-slate-400 hover:text-white'
                  }`}
                  style={
                    previewMode === 'login'
                      ? { background: `linear-gradient(135deg, ${instPrimary}, ${instAccent})` }
                      : undefined
                  }
                >
                  Login de Clientes (Préstamos y Cuotas)
                </button>
              </div>

              {previewMode === 'solicitud' ? (
                <div className="p-4 sm:p-5 rounded-xl border border-white/10 bg-[#07122B]/80">
                  <PublicCreditApplicationForm
                    portal={
                      publishedRecord ??
                      buildPublicPortalRecordFromOrg(selectedOrg, {
                        portalEnabled: portalEnabledDraft,
                        welcomeHeadline: headlineDraft,
                        welcomeSubtitle: subtitleDraft,
                      })
                    }
                    previewOnly
                    onSwitchToClientAuth={() => setPreviewMode('login')}
                  />
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-white/10 bg-white/[0.03] space-y-2 text-xs text-slate-300">
                  <p className="font-semibold text-white">
                    Portal Privado de Clientes (Aislado por Institución)
                  </p>
                  <p className="leading-relaxed">
                    Permite a los clientes finales ingresar o crear su cuenta vinculada exclusivamente
                    a <strong className="text-white">{selectedOrg.tradeName || selectedOrg.name}</strong>{' '}
                    para validar sus préstamos, calendario de cuotas, saldos y solicitar gestiones.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="px-4 py-2 rounded-xl border border-white/15 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
                >
                  Cerrar Vista Previa
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleOpenLiveInTab(
                      previewMode === 'solicitud'
                        ? generatedLinks.creditApplicationUrl
                        : generatedLinks.clientLoginUrl
                    )
                  }
                  className="px-4 py-2 rounded-xl text-white text-xs font-semibold cursor-pointer"
                  style={{
                    background: `linear-gradient(135deg, ${instPrimary}, ${instAccent})`,
                  }}
                >
                  Probar Enlace Real Ahora
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
