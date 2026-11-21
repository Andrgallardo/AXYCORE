import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Eye,
  FileText,
  Home,
  Mail,
  MapPin,
  PencilLine,
  Phone,
  Plus,
  Save,
  Search,
  ShieldCheck,
  UserCheck,
  UserCog,
  Users,
  UserX,
  X,
} from 'lucide-react';
import { useAxyCore } from '../context/AxyCoreContext';
import {
  buildCustomerDirectorySummaries,
  filterCustomerDirectory,
  type CustomerDirectoryFilter,
  type CustomerDirectorySummary,
} from '../engine/customerDirectory';
import {
  saveBusinessUnique,
  saveCustomerUnique,
  updateCustomerRecord,
} from '../services/axycoreStore';
import type { CustomerRecord, HousingType, SocialMediaStatus } from '../types/axycore';
import { formatMoney } from '../utils/formatters';

export type CustomersViewInitialSection = 'ALL' | 'ACTIVO' | 'INACTIVO' | 'UPDATE';

interface EditFormState {
  firstName: string;
  lastName: string;
  birthDate: string;
  nationality: string;
  maritalStatus: string;
  phone: string;
  altPhone: string;
  email: string;
  province: string;
  municipality: string;
  address: string;
  residenceMonths: string;
  housingType: HousingType;
  housingPayment: string;
  socialMediaDeclared: SocialMediaStatus;
  socialMediaHandle: string;
  altContactName: string;
  altContactPhone: string;
}

function toEditFormState(c: CustomerRecord): EditFormState {
  return {
    firstName: c.firstName || '',
    lastName: c.lastName || '',
    birthDate: c.birthDate || '',
    nationality: c.nationality || '',
    maritalStatus: c.maritalStatus || '',
    phone: c.phone || '',
    altPhone: c.altPhone || '',
    email: c.email || '',
    province: c.province || '',
    municipality: c.municipality || '',
    address: c.address || '',
    residenceMonths: String(c.residenceMonths ?? 0),
    housingType: c.housingType || 'NO_DECLARADA',
    housingPayment: String(c.housingPayment ?? 0),
    socialMediaDeclared: c.socialMediaDeclared || 'UNANSWERED',
    socialMediaHandle: c.socialMediaHandle || '',
    altContactName: c.altContactName || '',
    altContactPhone: c.altContactPhone || '',
  };
}

export function CustomersView({
  initialSection = 'ALL',
}: {
  initialSection?: CustomersViewInitialSection;
}) {
  const {
    customers,
    businesses,
    applications,
    loans,
    collectionAccounts,
    userProfile,
    rbac,
    setActiveSection,
    setSelectedCollectionLoanId,
  } = useAxyCore();

  const canUpdateCustomers = rbac.canAccessSection('customers_update');

  const [moduleMode, setModuleMode] = useState<'DIRECTORY' | 'UPDATE'>(
    initialSection === 'UPDATE' ? 'UPDATE' : 'DIRECTORY'
  );
  const [directoryTab, setDirectoryTab] = useState<'INDIVIDUALS' | 'BUSINESSES'>('INDIVIDUALS');
  const [statusFilter, setStatusFilter] = useState<CustomerDirectoryFilter>(
    initialSection === 'ACTIVO' || initialSection === 'INACTIVO' ? initialSection : 'ALL'
  );

  const [search, setSearch] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Selected customer for quick inspection modal
  const [inspectCustomerId, setInspectCustomerId] = useState<string | null>(null);

  // Update Customer state
  const [updateSearch, setUpdateSearch] = useState('');
  const [selectedEditCustomerId, setSelectedEditCustomerId] = useState<string>('');
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [updatingCustomer, setUpdatingCustomer] = useState(false);

  // Sync external sidebar navigation
  useEffect(() => {
    setFeedback(null);
    if (initialSection === 'UPDATE') {
      setModuleMode('UPDATE');
      setShowCreateForm(false);
    } else {
      setModuleMode('DIRECTORY');
      setDirectoryTab('INDIVIDUALS');
      setStatusFilter(initialSection);
    }
  }, [initialSection]);

  // New Customer Form state
  const [docType, setDocType] = useState<'CEDULA' | 'PASAPORTE'>('CEDULA');
  const [docNumber, setDocNumber] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [province, setProvince] = useState('Santo Domingo');
  const [municipality, setMunicipality] = useState('');
  const [address, setAddress] = useState('');
  const [residenceMonths, setResidenceMonths] = useState('24');
  const [housingType, setHousingType] = useState<HousingType>('ALQUILADA');
  const [housingPayment, setHousingPayment] = useState('0');
  const [socialDeclared, setSocialDeclared] = useState<SocialMediaStatus>('NO_MEDIA');
  const [socialHandle, setSocialHandle] = useState('');

  // New Business Form state
  const [rnc, setRnc] = useState('');
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [companyType, setCompanyType] = useState('SRL');
  const [economicActivity, setEconomicActivity] = useState('');
  const [authorizedRepName, setAuthorizedRepName] = useState('');
  const [authorizedRepDoc, setAuthorizedRepDoc] = useState('');

  const directorySummaries = useMemo(
    () =>
      buildCustomerDirectorySummaries({
        customers,
        loans,
        applications,
        collectionAccounts,
      }),
    [customers, loans, applications, collectionAccounts]
  );

  const summaryById = useMemo(() => {
    const map = new Map<string, CustomerDirectorySummary>();
    for (const s of directorySummaries) {
      map.set(s.customer.id, s);
    }
    return map;
  }, [directorySummaries]);

  const counts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let withoutLoans = 0;
    for (const s of directorySummaries) {
      if (s.portfolioStatus === 'ACTIVO') active += 1;
      else if (s.portfolioStatus === 'INACTIVO') inactive += 1;
      else withoutLoans += 1;
    }
    return {
      total: directorySummaries.length,
      active,
      inactive,
      withoutLoans,
    };
  }, [directorySummaries]);

  const filteredSummaries = useMemo(
    () => filterCustomerDirectory(directorySummaries, statusFilter, search),
    [directorySummaries, statusFilter, search]
  );

  const filteredBusinesses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return businesses.filter((b) => {
      if (!q) return true;
      return (
        b.legalName.toLowerCase().includes(q) ||
        (b.tradeName || '').toLowerCase().includes(q) ||
        b.rnc.toLowerCase().includes(q)
      );
    });
  }, [businesses, search]);

  const updateCandidates = useMemo(() => {
    return filterCustomerDirectory(directorySummaries, 'ALL', updateSearch);
  }, [directorySummaries, updateSearch]);

  // Auto-select first customer in Update mode if none chosen yet
  useEffect(() => {
    if (moduleMode !== 'UPDATE') return;
    if (selectedEditCustomerId) {
      const found = customers.find((c) => c.id === selectedEditCustomerId);
      if (found) {
        setEditForm((prev) => prev ?? toEditFormState(found));
        return;
      }
    }
    if (customers.length > 0 && !selectedEditCustomerId) {
      setSelectedEditCustomerId(customers[0].id);
      setEditForm(toEditFormState(customers[0]));
    }
  }, [moduleMode, customers, selectedEditCustomerId]);

  const selectedEditCustomer = useMemo(
    () => customers.find((c) => c.id === selectedEditCustomerId) ?? null,
    [customers, selectedEditCustomerId]
  );

  const inspectSummary = useMemo(
    () => (inspectCustomerId ? summaryById.get(inspectCustomerId) ?? null : null),
    [inspectCustomerId, summaryById]
  );

  const inspectLoans = useMemo(() => {
    if (!inspectCustomerId) return [];
    return loans.filter((l) => l.customerId === inspectCustomerId);
  }, [inspectCustomerId, loans]);

  const handleOpenUpdateForCustomer = (customer: CustomerRecord) => {
    setSelectedEditCustomerId(customer.id);
    setEditForm(toEditFormState(customer));
    setInspectCustomerId(null);
    setFeedback(null);
    setModuleMode('UPDATE');
    if (canUpdateCustomers) {
      setActiveSection('customers_update');
    }
  };

  const handleSelectEditCustomer = (customerId: string) => {
    const found = customers.find((c) => c.id === customerId);
    setSelectedEditCustomerId(customerId);
    setEditForm(found ? toEditFormState(found) : null);
    setFeedback(null);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await saveCustomerUnique({
        organizationId: userProfile.organizationId,
        documentType: docType,
        documentNumber: docNumber.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        province: province.trim(),
        municipality: municipality.trim(),
        address: address.trim(),
        residenceMonths: Number(residenceMonths) || 0,
        housingType,
        housingPayment: Number(housingPayment) || 0,
        socialMediaDeclared: socialDeclared,
        socialMediaHandle: socialHandle.trim(),
        createdBy: userProfile.uid,
      });
      setFeedback({
        type: 'ok',
        msg: `Cliente ${saved.firstName} ${saved.lastName} registrado con prevención de duplicados (${saved.documentType} ${saved.documentNumber}).`,
      });
      setDocNumber('');
      setFirstName('');
      setLastName('');
      setPhone('');
      setEmail('');
      setShowCreateForm(false);
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error registrando cliente.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile) return;
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await saveBusinessUnique({
        organizationId: userProfile.organizationId,
        rnc: rnc.trim(),
        legalName: legalName.trim(),
        tradeName: tradeName.trim(),
        companyType: companyType.trim(),
        economicActivity: economicActivity.trim(),
        authorizedRepName: authorizedRepName.trim(),
        authorizedRepDoc: authorizedRepDoc.trim(),
        createdBy: userProfile.uid,
      });
      setFeedback({
        type: 'ok',
        msg: `Empresa ${saved.legalName} (RNC ${saved.rnc}) registrada correctamente.`,
      });
      setRnc('');
      setLegalName('');
      setTradeName('');
      setAuthorizedRepName('');
      setShowCreateForm(false);
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Error registrando empresa.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !selectedEditCustomer || !editForm) return;
    setUpdatingCustomer(true);
    setFeedback(null);
    try {
      const updated = await updateCustomerRecord({
        customer: selectedEditCustomer,
        user: userProfile,
        updates: {
          firstName: editForm.firstName,
          lastName: editForm.lastName,
          birthDate: editForm.birthDate,
          nationality: editForm.nationality,
          maritalStatus: editForm.maritalStatus,
          phone: editForm.phone,
          altPhone: editForm.altPhone,
          email: editForm.email,
          province: editForm.province,
          municipality: editForm.municipality,
          address: editForm.address,
          residenceMonths: Number(editForm.residenceMonths) || 0,
          housingType: editForm.housingType,
          housingPayment: Number(editForm.housingPayment) || 0,
          socialMediaDeclared: editForm.socialMediaDeclared,
          socialMediaHandle: editForm.socialMediaHandle,
          altContactName: editForm.altContactName,
          altContactPhone: editForm.altContactPhone,
        },
      });
      setFeedback({
        type: 'ok',
        msg: `Datos de ${updated.firstName} ${updated.lastName} actualizados correctamente y auditados en bitácora.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'No se pudieron actualizar los datos del cliente.',
      });
    } finally {
      setUpdatingCustomer(false);
    }
  };

  const handleSelectDirectorySubmenu = (nextFilter: CustomerDirectoryFilter) => {
    setModuleMode('DIRECTORY');
    setDirectoryTab('INDIVIDUALS');
    setStatusFilter(nextFilter);
    setFeedback(null);
    if (nextFilter === 'ACTIVO') setActiveSection('customers_active');
    else if (nextFilter === 'INACTIVO') setActiveSection('customers_inactive');
    else setActiveSection('customers');
  };

  return (
    <div className="space-y-6">
      {/* Module Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white">
            Módulo Clientes
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Directorio maestro de clientes activos, inactivos con préstamos cancelados y actualización auditada de datos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Primary Module Mode Switcher */}
          <div className="inline-flex rounded-xl axy-surface p-1 text-xs">
            <button
              type="button"
              onClick={() => handleSelectDirectorySubmenu(statusFilter)}
              className={`px-3.5 py-1.5 rounded-lg font-semibold cursor-pointer flex items-center gap-1.5 transition-all ${
                moduleMode === 'DIRECTORY'
                  ? 'axy-brand-gradient text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-[var(--axy-surface-muted)]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Todos los Clientes</span>
            </button>
            {canUpdateCustomers && (
              <button
                type="button"
                onClick={() => {
                  setModuleMode('UPDATE');
                  setShowCreateForm(false);
                  setFeedback(null);
                  setActiveSection('customers_update');
                }}
                className={`px-3.5 py-1.5 rounded-lg font-semibold cursor-pointer flex items-center gap-1.5 transition-all ${
                  moduleMode === 'UPDATE'
                    ? 'axy-brand-gradient text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-[var(--axy-surface-muted)]'
                }`}
              >
                <UserCog className="w-3.5 h-3.5" />
                <span>Actualizar Datos de Clientes</span>
              </button>
            )}
          </div>

          {moduleMode === 'DIRECTORY' && (
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(!showCreateForm);
                setFeedback(null);
              }}
              className="axy-btn-primary inline-flex items-center gap-2 px-4 py-2 text-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{directoryTab === 'INDIVIDUALS' ? 'Nuevo Cliente' : 'Nueva Empresa'}</span>
            </button>
          )}

        </div>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{feedback.msg}</span>
          </span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-current opacity-70 hover:opacity-100 cursor-pointer"
            aria-label="Cerrar aviso"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ============================================================
          MODE 1: TODOS LOS CLIENTES (ACTIVOS / INACTIVOS / EMPRESAS)
         ============================================================ */}
      {moduleMode === 'DIRECTORY' && (
        <>
          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 rounded-2xl axy-surface">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Total Clientes Registrados
              </p>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-950 dark:text-white">
                {counts.total}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Directorio único por documento
              </p>
            </div>
            <div className="p-4 rounded-2xl axy-surface">
              <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5" />
                <span>Clientes Activos</span>
              </p>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-950 dark:text-white">
                {counts.active}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Con préstamo vigente en cartera
              </p>
            </div>
            <div className="p-4 rounded-2xl axy-surface">
              <p className="text-[11px] font-medium text-amber-600 dark:text-[#E2B35E] flex items-center gap-1.5">
                <UserX className="w-3.5 h-3.5" />
                <span>Clientes Inactivos</span>
              </p>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-950 dark:text-white">
                {counts.inactive}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Préstamos ya cancelados
              </p>
            </div>
            <div className="p-4 rounded-2xl axy-surface">
              <p className="text-[11px] font-medium text-[#0066FF] dark:text-[#00B8FF] flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                <span>Empresas / Pymes</span>
              </p>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-950 dark:text-white">
                {businesses.length}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Registros comerciales por RNC
              </p>
            </div>
          </div>

          {/* Submenu & Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* Submenu de Todos los Clientes: Todos / Activos / Inactivos */}
              <div className="inline-flex rounded-xl axy-surface p-1 text-xs">
                <button
                  type="button"
                  onClick={() => handleSelectDirectorySubmenu('ALL')}
                  className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer flex items-center gap-1.5 transition-colors ${
                    directoryTab === 'INDIVIDUALS' && statusFilter === 'ALL'
                      ? 'bg-[#041B4E] text-white dark:bg-[#0066FF]'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-[var(--axy-surface-muted)]'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Todos ({counts.total})</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectDirectorySubmenu('ACTIVO')}
                  className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer flex items-center gap-1.5 transition-colors ${
                    directoryTab === 'INDIVIDUALS' && statusFilter === 'ACTIVO'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-[var(--axy-surface-muted)]'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Activos ({counts.active})</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectDirectorySubmenu('INACTIVO')}
                  className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer flex items-center gap-1.5 transition-colors ${
                    directoryTab === 'INDIVIDUALS' && statusFilter === 'INACTIVO'
                      ? 'bg-amber-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-[var(--axy-surface-muted)]'
                  }`}
                >
                  <UserX className="w-3.5 h-3.5" />
                  <span>Inactivos ({counts.inactive})</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setDirectoryTab('BUSINESSES');
                  setShowCreateForm(false);
                }}
                className={`px-3.5 py-2 rounded-xl border text-xs font-medium cursor-pointer flex items-center gap-1.5 transition-colors ${
                  directoryTab === 'BUSINESSES'
                    ? 'border-[#00B8FF]/50 bg-[#0066FF]/15 text-[#0052CC] dark:text-[#00D1FF]'
                    : 'axy-btn-secondary text-slate-600 dark:text-slate-300'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Empresas / Pymes ({businesses.length})</span>
              </button>
            </div>

            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  directoryTab === 'INDIVIDUALS'
                    ? 'Buscar por nombre, cédula, teléfono o provincia...'
                    : 'Buscar empresa por razón social o RNC...'
                }
                className="axy-input w-full pl-9 pr-3 py-2 text-xs"
              />
            </div>
          </div>

          {/* Submenu context banner */}
          {directoryTab === 'INDIVIDUALS' && (
            <div className="axy-surface-tonal px-4 py-2.5 rounded-xl text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
              <span>
                {statusFilter === 'ACTIVO'
                  ? 'Mostrando únicamente clientes con al menos un préstamo activo vigente con la empresa.'
                  : statusFilter === 'INACTIVO'
                  ? 'Mostrando clientes inactivos cuyos préstamos con la empresa ya han sido cancelados en su totalidad.'
                  : 'Mostrando el directorio completo de clientes registrados (activos, con préstamos cancelados y nuevos prospectos).'}
              </span>
              <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-[#00B8FF]">
                {filteredSummaries.length} resultado(s)
              </span>
            </div>
          )}

          {/* Create Form (Persona Física or Empresa) */}
          {showCreateForm && directoryTab === 'INDIVIDUALS' && (
            <form
              onSubmit={handleSaveCustomer}
              className="axy-surface p-5 rounded-2xl space-y-4 text-xs"
            >
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                Registrar Nueva Persona Física
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Tipo Documento *</label>
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value as 'CEDULA' | 'PASAPORTE')}
                    className="axy-input w-full px-2.5 py-2"
                  >
                    <option value="CEDULA">Cédula</option>
                    <option value="PASAPORTE">Pasaporte</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Número Documento *</label>
                  <input
                    required
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    placeholder="001-0000000-0"
                    className="axy-input w-full px-2.5 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Nombres *</label>
                  <input
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="axy-input w-full px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Apellidos *</label>
                  <input
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="axy-input w-full px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Teléfono *</label>
                  <input
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="axy-input w-full px-2.5 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Correo (Opcional)</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="axy-input w-full px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Provincia</label>
                  <input
                    value={province}
                    onChange={(e) => setProvince(e.target.value)}
                    className="axy-input w-full px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Municipio / Sector</label>
                  <input
                    value={municipality}
                    onChange={(e) => setMunicipality(e.target.value)}
                    className="axy-input w-full px-2.5 py-2"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Dirección</label>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="axy-input w-full px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Tipo Vivienda</label>
                  <select
                    value={housingType}
                    onChange={(e) => setHousingType(e.target.value as HousingType)}
                    className="axy-input w-full px-2.5 py-2"
                  >
                    <option value="PROPIA">Propia</option>
                    <option value="ALQUILADA">Alquilada</option>
                    <option value="FAMILIAR">Familiar</option>
                    <option value="OTRA">Otra</option>
                    <option value="NO_DECLARADA">No declarada</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Meses en Residencia</label>
                  <input
                    type="number"
                    min={0}
                    value={residenceMonths}
                    onChange={(e) => setResidenceMonths(e.target.value)}
                    className="axy-input w-full px-2.5 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Pago Vivienda Mensual</label>
                  <input
                    type="number"
                    min={0}
                    value={housingPayment}
                    onChange={(e) => setHousingPayment(e.target.value)}
                    className="axy-input w-full px-2.5 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Redes Sociales</label>
                  <select
                    value={socialDeclared}
                    onChange={(e) => setSocialDeclared(e.target.value as SocialMediaStatus)}
                    className="axy-input w-full px-2.5 py-2"
                  >
                    <option value="YES">Declara usuario</option>
                    <option value="NO_MEDIA">No posee redes</option>
                    <option value="UNANSWERED">Sin responder</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Usuario / Perfil Social (Opcional)</label>
                  <input
                    value={socialHandle}
                    onChange={(e) => setSocialHandle(e.target.value)}
                    placeholder="@usuario"
                    className="axy-input w-full px-2.5 py-2"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="axy-btn-secondary px-4 py-2 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="axy-btn-primary px-5 py-2 cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Validando unicidad...' : 'Guardar Cliente'}
                </button>
              </div>
            </form>
          )}

          {showCreateForm && directoryTab === 'BUSINESSES' && (
            <form
              onSubmit={handleSaveBusiness}
              className="axy-surface p-5 rounded-2xl space-y-4 text-xs"
            >
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                Registrar Empresa / Negocio
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">RNC *</label>
                  <input
                    required
                    value={rnc}
                    onChange={(e) => setRnc(e.target.value)}
                    placeholder="130-00000-1"
                    className="axy-input w-full px-2.5 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Razón Social *</label>
                  <input
                    required
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    className="axy-input w-full px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Nombre Comercial</label>
                  <input
                    value={tradeName}
                    onChange={(e) => setTradeName(e.target.value)}
                    className="axy-input w-full px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Tipo Societario</label>
                  <input
                    value={companyType}
                    onChange={(e) => setCompanyType(e.target.value)}
                    placeholder="SRL / EIRL / Persona Física"
                    className="axy-input w-full px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Actividad Económica</label>
                  <input
                    value={economicActivity}
                    onChange={(e) => setEconomicActivity(e.target.value)}
                    className="axy-input w-full px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Representante Autorizado *</label>
                  <input
                    required
                    value={authorizedRepName}
                    onChange={(e) => setAuthorizedRepName(e.target.value)}
                    className="axy-input w-full px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="block mb-1 text-slate-500 dark:text-slate-400">Cédula Representante</label>
                  <input
                    value={authorizedRepDoc}
                    onChange={(e) => setAuthorizedRepDoc(e.target.value)}
                    className="axy-input w-full px-2.5 py-2 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="axy-btn-secondary px-4 py-2 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="axy-btn-primary px-5 py-2 cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Validando RNC...' : 'Guardar Empresa'}
                </button>
              </div>
            </form>
          )}

          {/* Directory Tables */}
          {directoryTab === 'INDIVIDUALS' ? (
            <div className="axy-surface rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="axy-table-head text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-4 font-semibold">Cliente</th>
                      <th className="py-3 px-4 font-semibold">Documento</th>
                      <th className="py-3 px-4 font-semibold">Contacto</th>
                      <th className="py-3 px-4 font-semibold">Ubicación</th>
                      <th className="py-3 px-4 font-semibold">Estado en Empresa</th>
                      <th className="py-3 px-4 font-semibold text-right">Saldo Vigente</th>
                      <th className="py-3 px-4 font-semibold text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSummaries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-slate-500 dark:text-slate-400">
                          {statusFilter === 'ACTIVO'
                            ? 'No hay clientes con préstamos activos bajo el filtro aplicado.'
                            : statusFilter === 'INACTIVO'
                            ? 'No hay clientes con préstamos cancelados bajo el filtro aplicado.'
                            : 'No se encontraron clientes con el filtro aplicado.'}
                        </td>
                      </tr>
                    ) : (
                      filteredSummaries.map((item) => {
                        const c = item.customer;
                        return (
                          <tr
                            key={c.id}
                            className="axy-table-row"
                          >
                            <td className="py-3 px-4">
                              <div className="font-semibold text-slate-950 dark:text-white">
                                {c.firstName} {c.lastName}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                                {item.applicationsCount} solicitud(es) · {item.totalLoansCount} préstamo(s)
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-200">
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">
                                {c.documentType}:
                              </span>
                              {c.documentNumber}
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-mono text-slate-800 dark:text-slate-200">{c.phone}</div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                                {c.email || 'Sin correo'}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                              <div>{c.province || '—'}{c.municipality ? `, ${c.municipality}` : ''}</div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {c.housingType || 'NO_DECLARADA'}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              {item.portfolioStatus === 'ACTIVO' ? (
                                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  Activo · {item.activeLoansCount} préstamo(s)
                                </span>
                              ) : item.portfolioStatus === 'INACTIVO' ? (
                                <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600 dark:text-[#E2B35E]">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                  Inactivo · {item.canceledLoansCount} cancelado(s)
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 font-medium text-slate-500 dark:text-slate-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                  Sin préstamos
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-white">
                              {item.totalActiveBalanceDop > 0 && (
                                <div>{formatMoney(item.totalActiveBalanceDop, 'DOP')}</div>
                              )}
                              {item.totalActiveBalanceUsd > 0 && (
                                <div className="text-[#00B8FF]">
                                  {formatMoney(item.totalActiveBalanceUsd, 'USD')}
                                </div>
                              )}
                              {item.totalActiveBalanceDop === 0 && item.totalActiveBalanceUsd === 0 && (
                                <span className="text-slate-400">0.00</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setInspectCustomerId(c.id)}
                                  className="axy-btn-secondary px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>Ficha</span>
                                </button>
                                {canUpdateCustomers && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenUpdateForCustomer(c)}
                                    className="px-2.5 py-1.5 rounded-lg bg-[#0066FF]/12 hover:bg-[#0066FF]/22 border border-[#00B8FF]/30 text-[11px] font-semibold text-[#0052CC] dark:text-[#00D1FF] inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <PencilLine className="w-3 h-3" />
                                    <span>Actualizar</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="axy-surface rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="axy-table-head text-slate-500 dark:text-slate-400">
                      <th className="py-3 px-4 font-semibold">Razón Social / Comercial</th>
                      <th className="py-3 px-4 font-semibold">RNC</th>
                      <th className="py-3 px-4 font-semibold">Actividad</th>
                      <th className="py-3 px-4 font-semibold">Representante</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBusinesses.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-500">
                          No hay empresas registradas.
                        </td>
                      </tr>
                    ) : (
                      filteredBusinesses.map((b) => (
                        <tr key={b.id} className="axy-table-row">
                          <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                            {b.legalName}
                            {b.tradeName ? ` (${b.tradeName})` : ''}
                          </td>
                          <td className="py-3 px-4 font-mono">{b.rnc}</td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                            {b.companyType || '—'} · {b.economicActivity || '—'}
                          </td>
                          <td className="py-3 px-4">{b.authorizedRepName}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ============================================================
          MODE 2: ACTUALIZAR DATOS DE CLIENTES
         ============================================================ */}
      {moduleMode === 'UPDATE' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Panel: Searchable Customer Selector */}
          <div className="lg:col-span-4 rounded-2xl axy-surface p-4 flex flex-col gap-3 max-h-[720px]">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white">
                Seleccionar Cliente
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Elige un cliente para editar sus datos personales, de contacto o domicilio.
              </p>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                value={updateSearch}
                onChange={(e) => setUpdateSearch(e.target.value)}
                placeholder="Filtrar por nombre o cédula..."
                className="axy-input w-full pl-9 pr-3 py-2 text-xs"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {updateCandidates.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  No se encontraron clientes disponibles.
                </p>
              ) : (
                updateCandidates.map((item) => {
                  const c = item.customer;
                  const isSelected = c.id === selectedEditCustomerId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectEditCustomer(c.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[#00B8FF]/60 bg-[#0066FF]/12 dark:bg-[#0066FF]/18'
                          : 'border-[var(--axy-border)] hover:bg-[var(--axy-surface-muted)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-xs text-slate-950 dark:text-white truncate">
                          {c.firstName} {c.lastName}
                        </span>
                        <span
                          className={`text-[10px] font-semibold shrink-0 ${
                            item.portfolioStatus === 'ACTIVO'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : item.portfolioStatus === 'INACTIVO'
                              ? 'text-amber-600 dark:text-[#E2B35E]'
                              : 'text-slate-400'
                          }`}
                        >
                          {item.portfolioStatus === 'ACTIVO'
                            ? 'Activo'
                            : item.portfolioStatus === 'INACTIVO'
                            ? 'Inactivo'
                            : 'Sin préstamos'}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        <span>{c.documentNumber}</span>
                        <span>{c.phone}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel: Editable Customer Record Form */}
          <div className="lg:col-span-8">
            {!canUpdateCustomers ? (
              <div className="p-8 rounded-2xl axy-surface text-center space-y-2">
                <ShieldCheck className="w-8 h-8 text-[#00B8FF] mx-auto" />
                <h3 className="font-display text-sm font-bold">Acceso de Solo Lectura</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Tu rol ({rbac.roleLabel}) tiene acceso de auditoría/consulta y no puede modificar expedientes de clientes.
                </p>
              </div>
            ) : !selectedEditCustomer || !editForm ? (
              <div className="p-10 rounded-2xl axy-surface text-center text-xs text-slate-500 dark:text-slate-400">
                Selecciona un cliente del listado izquierdo para actualizar sus datos.
              </div>
            ) : (
              <form
                onSubmit={handleUpdateCustomerSubmit}
                className="rounded-2xl axy-surface p-5 sm:p-6 space-y-6 text-xs"
              >
                {/* Immutable Identity Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--axy-border)]">
                  <div>
                    <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
                      {selectedEditCustomer.firstName} {selectedEditCustomer.lastName}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                      Llave Única Inmutable: {selectedEditCustomer.documentType}{' '}
                      {selectedEditCustomer.documentNumber}
                    </p>
                  </div>
                  <div className="text-right">
                    {(() => {
                      const sum = summaryById.get(selectedEditCustomer.id);
                      if (!sum) return null;
                      return (
                        <div className="text-[11px] font-semibold">
                          {sum.portfolioStatus === 'ACTIVO' ? (
                            <span className="text-emerald-600 dark:text-emerald-400">
                              Cliente Activo · {sum.activeLoansCount} préstamo(s) vigente(s)
                            </span>
                          ) : sum.portfolioStatus === 'INACTIVO' ? (
                            <span className="text-amber-600 dark:text-[#E2B35E]">
                              Cliente Inactivo · {sum.canceledLoansCount} préstamo(s) cancelado(s)
                            </span>
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400">
                              Prospecto sin préstamos desembolsados
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Section 1: Identidad y Datos Personales */}
                <div className="space-y-3">
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-[#0052CC] dark:text-[#00B8FF] flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    <span>1. Identidad y Datos Personales</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Nombres *</label>
                      <input
                        required
                        value={editForm.firstName}
                        onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                        className="axy-input w-full px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Apellidos *</label>
                      <input
                        required
                        value={editForm.lastName}
                        onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                        className="axy-input w-full px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Fecha de Nacimiento</label>
                      <input
                        type="date"
                        value={editForm.birthDate}
                        onChange={(e) => setEditForm({ ...editForm, birthDate: e.target.value })}
                        className="axy-input w-full px-3 py-2 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Nacionalidad</label>
                      <input
                        value={editForm.nationality}
                        onChange={(e) => setEditForm({ ...editForm, nationality: e.target.value })}
                        placeholder="Dominicana"
                        className="axy-input w-full px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Estado Civil</label>
                      <select
                        value={editForm.maritalStatus}
                        onChange={(e) => setEditForm({ ...editForm, maritalStatus: e.target.value })}
                        className="axy-input w-full px-3 py-2"
                      >
                        <option value="">Sin especificar</option>
                        <option value="SOLTERO">Soltero/a</option>
                        <option value="CASADO">Casado/a</option>
                        <option value="UNION_LIBRE">Unión Libre</option>
                        <option value="DIVORCIADO">Divorciado/a</option>
                        <option value="VIUDO">Viudo/a</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Section 2: Contacto y Redes */}
                <div className="space-y-3">
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-[#0052CC] dark:text-[#00B8FF] flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5" />
                    <span>2. Contacto, Referencia Alterna y Redes</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Teléfono Principal *</label>
                      <input
                        required
                        value={editForm.phone}
                        onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                        className="axy-input w-full px-3 py-2 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Teléfono Alterno</label>
                      <input
                        value={editForm.altPhone}
                        onChange={(e) => setEditForm({ ...editForm, altPhone: e.target.value })}
                        className="axy-input w-full px-3 py-2 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Correo Electrónico</label>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                        className="axy-input w-full px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Contacto Alterno (Nombre)</label>
                      <input
                        value={editForm.altContactName}
                        onChange={(e) => setEditForm({ ...editForm, altContactName: e.target.value })}
                        className="axy-input w-full px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Contacto Alterno (Teléfono)</label>
                      <input
                        value={editForm.altContactPhone}
                        onChange={(e) => setEditForm({ ...editForm, altContactPhone: e.target.value })}
                        className="axy-input w-full px-3 py-2 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Estado Redes Sociales</label>
                      <select
                        value={editForm.socialMediaDeclared}
                        onChange={(e) =>
                          setEditForm({ ...editForm, socialMediaDeclared: e.target.value as SocialMediaStatus })
                        }
                        className="axy-input w-full px-3 py-2"
                      >
                        <option value="YES">Declara usuario</option>
                        <option value="NO_MEDIA">No posee redes</option>
                        <option value="UNANSWERED">Sin responder</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Usuario / Perfil Social</label>
                      <input
                        value={editForm.socialMediaHandle}
                        onChange={(e) => setEditForm({ ...editForm, socialMediaHandle: e.target.value })}
                        placeholder="@usuario"
                        className="axy-input w-full px-3 py-2"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 3: Domicilio y Vivienda */}
                <div className="space-y-3">
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-[#0052CC] dark:text-[#00B8FF] flex items-center gap-1.5">
                    <Home className="w-3.5 h-3.5" />
                    <span>3. Domicilio y Vivienda</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Provincia</label>
                      <input
                        value={editForm.province}
                        onChange={(e) => setEditForm({ ...editForm, province: e.target.value })}
                        className="axy-input w-full px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Municipio / Sector</label>
                      <input
                        value={editForm.municipality}
                        onChange={(e) => setEditForm({ ...editForm, municipality: e.target.value })}
                        className="axy-input w-full px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Tipo de Vivienda</label>
                      <select
                        value={editForm.housingType}
                        onChange={(e) => setEditForm({ ...editForm, housingType: e.target.value as HousingType })}
                        className="axy-input w-full px-3 py-2"
                      >
                        <option value="PROPIA">Propia</option>
                        <option value="ALQUILADA">Alquilada</option>
                        <option value="FAMILIAR">Familiar</option>
                        <option value="OTRA">Otra</option>
                        <option value="NO_DECLARADA">No declarada</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2 lg:col-span-2">
                      <label className="block mb-1 text-slate-500 dark:text-slate-400">Dirección Completa</label>
                      <input
                        value={editForm.address}
                        onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                        className="axy-input w-full px-3 py-2"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block mb-1 text-slate-500 dark:text-slate-400">Meses Resid.</label>
                        <input
                          type="number"
                          min={0}
                          max={1200}
                          value={editForm.residenceMonths}
                          onChange={(e) => setEditForm({ ...editForm, residenceMonths: e.target.value })}
                          className="axy-input w-full px-3 py-2 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block mb-1 text-slate-500 dark:text-slate-400">Pago Vivienda</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.housingPayment}
                          onChange={(e) => setEditForm({ ...editForm, housingPayment: e.target.value })}
                          className="axy-input w-full px-3 py-2 font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-[var(--axy-border)] flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setEditForm(toEditFormState(selectedEditCustomer))}
                    className="axy-btn-secondary px-4 py-2 text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    Restablecer Cambios
                  </button>
                  <button
                    type="submit"
                    disabled={updatingCustomer}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl axy-brand-gradient hover:brightness-110 text-white font-semibold cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    <span>{updatingCustomer ? 'Guardando actualización...' : 'Guardar Cambios del Cliente'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ============================================================
          QUICK CUSTOMER PROFILE INSPECTION MODAL
         ============================================================ */}
      {inspectSummary && (
        <div className="fixed inset-0 z-50 bg-[#030816]/70 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="axy-panel-in axy-surface w-full max-w-2xl rounded-2xl border border-[var(--axy-border-strong)] shadow-2xl overflow-hidden">
            <div className="axy-infinity-line" />
            <div className="px-5 py-4 border-b border-[var(--axy-border)] flex items-center justify-between gap-3 bg-[var(--axy-surface-tonal)]">
              <div>
                <h3 className="font-display text-base font-bold text-slate-950 dark:text-white">
                  {inspectSummary.customer.firstName} {inspectSummary.customer.lastName}
                </h3>
                <p className="text-[11px] font-mono text-slate-500 dark:text-[#00B8FF]">
                  {inspectSummary.customer.documentType}: {inspectSummary.customer.documentNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectCustomerId(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
                aria-label="Cerrar ficha"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="axy-surface-tonal p-3.5 rounded-xl space-y-1.5">
                  <p className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-[#00B8FF]" />
                    <span>Contacto</span>
                  </p>
                  <p className="font-mono">{inspectSummary.customer.phone}</p>
                  {inspectSummary.customer.altPhone && (
                    <p className="font-mono text-slate-500 dark:text-slate-400">
                      Alt: {inspectSummary.customer.altPhone}
                    </p>
                  )}
                  <p className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                    <Mail className="w-3 h-3" />
                    <span>{inspectSummary.customer.email || 'Sin correo'}</span>
                  </p>
                  {inspectSummary.customer.altContactName && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Ref. Alterna: {inspectSummary.customer.altContactName} ({inspectSummary.customer.altContactPhone || '—'})
                    </p>
                  )}
                </div>

                <div className="axy-surface-tonal p-3.5 rounded-xl space-y-1.5">
                  <p className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#00B8FF]" />
                    <span>Domicilio y Vivienda</span>
                  </p>
                  <p>{inspectSummary.customer.address || 'Dirección no registrada'}</p>
                  <p className="text-slate-500 dark:text-slate-400">
                    {inspectSummary.customer.municipality || '—'}, {inspectSummary.customer.province || '—'}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Vivienda: {inspectSummary.customer.housingType || 'NO_DECLARADA'} ·{' '}
                    {inspectSummary.customer.residenceMonths ?? 0} meses
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-display font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-[#00B8FF]" />
                  <span>Historial de Préstamos en la Empresa ({inspectLoans.length})</span>
                </h4>
                {inspectLoans.length === 0 ? (
                  <p className="axy-surface-tonal p-3 rounded-xl text-slate-500 dark:text-slate-400">
                    Este cliente aún no tiene préstamos desembolsados.
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--axy-border)] rounded-xl border border-[var(--axy-border)] overflow-hidden">
                    {inspectLoans.map((loan) => (
                      <div
                        key={loan.id}
                        className="p-3 flex flex-wrap items-center justify-between gap-2 bg-[var(--axy-surface-tonal)]"
                      >
                        <div>
                          <span className="font-mono font-bold text-slate-900 dark:text-white">
                            {loan.loanNumber}
                          </span>
                          <span className="mx-2 text-slate-400">·</span>
                          <span className="text-slate-500 dark:text-slate-400">
                            Desembolso {loan.disbursementDate}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 font-mono tabular-nums">
                          <span>
                            Saldo: <strong>{formatMoney(loan.currentPrincipalBalance, loan.currency)}</strong>
                          </span>
                          <span
                            className={`font-sans font-semibold ${
                              loan.status === 'CANCELADO' || loan.status === 'PAGADO'
                                ? 'text-amber-600 dark:text-[#E2B35E]'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {loan.status}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setInspectCustomerId(null);
                              setSelectedCollectionLoanId(loan.id);
                            }}
                            className="font-sans text-[11px] font-semibold text-[#0066FF] dark:text-[#00B8FF] hover:underline cursor-pointer"
                          >
                            Ver 360°
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-[var(--axy-border)] flex items-center justify-end gap-2 bg-[var(--axy-surface-tonal)]">
              <button
                type="button"
                onClick={() => setInspectCustomerId(null)}
                className="axy-btn-secondary px-4 py-2 text-xs font-medium cursor-pointer"
              >
                Cerrar
              </button>
              {canUpdateCustomers && (
                <button
                  type="button"
                  onClick={() => handleOpenUpdateForCustomer(inspectSummary.customer)}
                  className="px-4 py-2 rounded-xl axy-brand-gradient text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <PencilLine className="w-3.5 h-3.5" />
                  <span>Actualizar Datos de este Cliente</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
