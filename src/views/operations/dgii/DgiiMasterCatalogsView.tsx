import React, { useMemo, useState } from 'react';
import { Building2, Download, Package, Plus, Search, UserPlus, Users, X } from 'lucide-react';
import { useAxyCore } from '../../../context/AxyCoreContext';
import { validateTaxIdByType } from '../../../engine/dgii/dgiiCatalogAndValidation';
import { generateId } from '../../../services/axycoreStore';
import { saveDgiiProduct, saveDgiiReceiver } from '../../../services/dgiiEcfStore';
import type {
  DgiiProductRecord,
  DgiiReceiverRecord,
  EcfItbisRate,
  OtherTaxCode,
} from '../../../types/dgiiEcf';
import type { CurrencyCode } from '../../../types/axycore';
import { formatMoney } from '../../../utils/formatters';

export function DgiiMasterCatalogsView({ mode }: { mode: 'customers' | 'products' }) {
  const {
    organization,
    userProfile,
    rbac,
    dgiiReceivers,
    dgiiProducts,
    customers,
    businesses,
    accountingAccounts,
  } = useAxyCore();

  const canWrite = rbac.hasPermission('EMIT_ECF') || rbac.hasPermission('MANAGE_DGII_CONFIG');
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Receiver modal state
  const [recModalOpen, setRecModalOpen] = useState(false);
  const [editingRec, setEditingRec] = useState<DgiiReceiverRecord | null>(null);
  const [partyRole, setPartyRole] = useState<DgiiReceiverRecord['partyRole']>('CLIENTE');
  const [idType, setIdType] = useState<DgiiReceiverRecord['idType']>('RNC');
  const [taxId, setTaxId] = useState('');
  const [legalName, setLegalName] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [taxRegime, setTaxRegime] = useState<DgiiReceiverRecord['taxRegime']>('ORDINARIO');

  // Product modal state
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<DgiiProductRecord | null>(null);
  const [sku, setSku] = useState('');
  const [prodName, setProdName] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [itemType, setItemType] = useState<'BIEN' | 'SERVICIO'>('SERVICIO');
  const [unitOfMeasure, setUnitOfMeasure] = useState('UND');
  const [unitPrice, setUnitPrice] = useState(0);
  const [prodCurrency, setProdCurrency] = useState<CurrencyCode>(organization.currency || 'DOP');
  const [itbisRate, setItbisRate] = useState<EcfItbisRate>(18);
  const [isExempt, setIsExempt] = useState(false);
  const [otherTaxCode, setOtherTaxCode] = useState<OtherTaxCode>('NINGUNO');
  const [otherTaxRatePct, setOtherTaxRatePct] = useState(0);
  const [incomeAccountCode, setIncomeAccountCode] = useState('4101');
  const [expenseAccountCode, setExpenseAccountCode] = useState('5101');

  const postableAccounts = useMemo(
    () => accountingAccounts.filter((a) => a.isPostable && a.status === 'ACTIVA'),
    [accountingAccounts]
  );

  const filteredReceivers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dgiiReceivers.filter((r) => {
      if (!q) return true;
      return `${r.legalName} ${r.taxId} ${r.email}`.toLowerCase().includes(q);
    });
  }, [dgiiReceivers, search]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dgiiProducts.filter((p) => {
      if (!q) return true;
      return `${p.sku} ${p.name} ${p.description}`.toLowerCase().includes(q);
    });
  }, [dgiiProducts, search]);

  const openNewReceiver = () => {
    setEditingRec(null);
    setPartyRole('CLIENTE');
    setIdType('RNC');
    setTaxId('');
    setLegalName('');
    setAddress('');
    setEmail('');
    setPhone('');
    setTaxRegime('ORDINARIO');
    setRecModalOpen(true);
  };

  const openEditReceiver = (r: DgiiReceiverRecord) => {
    setEditingRec(r);
    setPartyRole(r.partyRole);
    setIdType(r.idType);
    setTaxId(r.taxId);
    setLegalName(r.legalName);
    setAddress(r.address);
    setEmail(r.email);
    setPhone(r.phone);
    setTaxRegime(r.taxRegime);
    setRecModalOpen(true);
  };

  const handleSaveReceiver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || !userProfile) return;
    const idRes = validateTaxIdByType(idType, taxId);
    if (!idRes.valid) {
      setFeedback({ kind: 'err', text: idRes.reason || 'Documento inválido.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await saveDgiiReceiver({
        isNew: !editingRec,
        receiver: {
          id: editingRec?.id || generateId('dgrec'),
          organizationId: organization.id,
          partyRole,
          idType,
          taxId: idRes.normalized,
          legalName: legalName.trim(),
          address: address.trim() || 'República Dominicana',
          email: email.trim(),
          phone: phone.trim(),
          taxRegime,
          linkedCustomerId: editingRec?.linkedCustomerId,
          status: 'ACTIVO',
          createdBy: editingRec?.createdBy || userProfile.uid,
        },
      });
      setRecModalOpen(false);
      setFeedback({ kind: 'ok', text: `Receptor fiscal ${legalName.trim()} guardado correctamente.` });
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Error guardando receptor.' });
    } finally {
      setBusy(false);
    }
  };

  const handleImportFromAxyCore = async () => {
    if (!canWrite || !userProfile) return;
    setBusy(true);
    setFeedback(null);
    try {
      const existingKeys = new Set(dgiiReceivers.map((r) => `${r.idType}_${r.taxId}`));
      let imported = 0;

      // Read-only import from businesses (RNC)
      for (const b of businesses) {
        const cleanRnc = String(b.rnc || '').replace(/\D/g, '');
        if (!cleanRnc || existingKeys.has(`RNC_${cleanRnc}`)) continue;
        await saveDgiiReceiver({
          isNew: true,
          receiver: {
            id: generateId('dgrec'),
            organizationId: organization.id,
            partyRole: 'CLIENTE',
            idType: 'RNC',
            taxId: cleanRnc,
            legalName: b.legalName || b.tradeName || 'Empresa',
            tradeName: b.tradeName,
            address: 'República Dominicana',
            email: '',
            phone: '',
            taxRegime: 'ORDINARIO',
            linkedCustomerId: b.id,
            status: 'ACTIVO',
            createdBy: userProfile.uid,
          },
        });
        existingKeys.add(`RNC_${cleanRnc}`);
        imported++;
      }

      // Read-only import from customers (Cédula / Pasaporte)
      for (const c of customers) {
        const mappedType = c.documentType === 'PASAPORTE' ? 'PASAPORTE' : 'CEDULA';
        const cleanDoc =
          mappedType === 'CEDULA'
            ? String(c.documentNumber || '').replace(/\D/g, '')
            : String(c.documentNumber || '').trim().toUpperCase();
        if (!cleanDoc || existingKeys.has(`${mappedType}_${cleanDoc}`)) continue;
        await saveDgiiReceiver({
          isNew: true,
          receiver: {
            id: generateId('dgrec'),
            organizationId: organization.id,
            partyRole: 'CLIENTE',
            idType: mappedType,
            taxId: cleanDoc,
            legalName: `${c.firstName} ${c.lastName}`.trim(),
            address: c.address || 'República Dominicana',
            municipality: c.municipality,
            province: c.province,
            email: c.email || '',
            phone: c.phone || '',
            taxRegime: 'CONSUMIDOR_FINAL',
            linkedCustomerId: c.id,
            status: 'ACTIVO',
            createdBy: userProfile.uid,
          },
        });
        existingKeys.add(`${mappedType}_${cleanDoc}`);
        imported++;
      }

      setFeedback({
        kind: 'ok',
        text:
          imported > 0
            ? `Se importaron ${imported} clientes/empresas desde AxyCore sin modificar los registros de cartera.`
            : 'Todos los clientes y empresas de AxyCore ya estaban sincronizados en el catálogo fiscal.',
      });
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Error importando desde AxyCore.' });
    } finally {
      setBusy(false);
    }
  };

  const openNewProduct = () => {
    setEditingProd(null);
    setSku(`SRV-${String(dgiiProducts.length + 1).padStart(3, '0')}`);
    setProdName('');
    setProdDesc('');
    setItemType('SERVICIO');
    setUnitOfMeasure('UND');
    setUnitPrice(0);
    setProdCurrency(organization.currency || 'DOP');
    setItbisRate(18);
    setIsExempt(false);
    setOtherTaxCode('NINGUNO');
    setOtherTaxRatePct(0);
    setIncomeAccountCode('4101');
    setExpenseAccountCode('5101');
    setProdModalOpen(true);
  };

  const openEditProduct = (p: DgiiProductRecord) => {
    setEditingProd(p);
    setSku(p.sku);
    setProdName(p.name);
    setProdDesc(p.description);
    setItemType(p.itemType);
    setUnitOfMeasure(p.unitOfMeasure);
    setUnitPrice(p.unitPrice);
    setProdCurrency(p.currency);
    setItbisRate(p.itbisRate);
    setIsExempt(p.isExempt);
    setOtherTaxCode(p.otherTaxCode);
    setOtherTaxRatePct(p.otherTaxRatePct);
    setIncomeAccountCode(p.incomeAccountCode);
    setExpenseAccountCode(p.expenseAccountCode);
    setProdModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || !userProfile) return;
    setBusy(true);
    setFeedback(null);
    try {
      await saveDgiiProduct({
        isNew: !editingProd,
        product: {
          id: editingProd?.id || generateId('dgprod'),
          organizationId: organization.id,
          sku: sku.trim().toUpperCase(),
          name: prodName.trim(),
          description: prodDesc.trim() || prodName.trim(),
          itemType,
          unitOfMeasure: unitOfMeasure.trim() || 'UND',
          unitPrice: Math.max(0, Number(unitPrice) || 0),
          currency: prodCurrency,
          itbisRate: isExempt ? 0 : itbisRate,
          isExempt,
          otherTaxCode,
          otherTaxRatePct: otherTaxCode === 'NINGUNO' ? 0 : Math.max(0, Number(otherTaxRatePct) || 0),
          incomeAccountCode,
          expenseAccountCode,
          status: 'ACTIVO',
          createdBy: editingProd?.createdBy || userProfile.uid,
        },
      });
      setProdModalOpen(false);
      setFeedback({ kind: 'ok', text: `Producto/Servicio ${prodName.trim()} guardado.` });
    } catch (err) {
      setFeedback({ kind: 'err', text: err instanceof Error ? err.message : 'Error guardando producto.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-xl font-bold text-slate-950 dark:text-white flex items-center gap-2">
            {mode === 'customers' ? (
              <Users className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
            ) : (
              <Package className="w-5 h-5 text-[#0066FF] dark:text-[#00B8FF]" />
            )}
            <span>
              {mode === 'customers'
                ? 'Clientes, Proveedores y Receptores Fiscales e-CF'
                : 'Catálogo de Productos y Servicios Facturables'}
            </span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            {mode === 'customers'
              ? 'Directorio fiscal multiempresa validado con dígito verificador DGII/JCE.'
              : 'Ítems con tasa de ITBIS (18%, 16% o Exento), otros impuestos y mapeo contable.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mode === 'customers' && canWrite && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={handleImportFromAxyCore}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/15 font-semibold cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#00B8FF]" />
                <span>Sincronizar desde Clientes / Empresas</span>
              </button>
              <button
                type="button"
                onClick={openNewReceiver}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Nuevo Receptor</span>
              </button>
            </>
          )}
          {mode === 'products' && canWrite && (
            <button
              type="button"
              onClick={openNewProduct}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nuevo Producto / Servicio</span>
            </button>
          )}
        </div>
      </div>

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

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={mode === 'customers' ? 'Buscar receptor por RNC, cédula o nombre...' : 'Buscar SKU o producto...'}
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#08132B]"
        />
      </div>

      {mode === 'customers' ? (
        <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase text-slate-500">
                  <th className="py-2.5 px-3">Rol</th>
                  <th className="py-2.5 px-3">Tipo ID</th>
                  <th className="py-2.5 px-3">RNC / Cédula</th>
                  <th className="py-2.5 px-3">Razón Social</th>
                  <th className="py-2.5 px-3">Régimen</th>
                  <th className="py-2.5 px-3">Correo / Teléfono</th>
                  <th className="py-2.5 px-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredReceivers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      Sin receptores registrados. Puede crear uno nuevo o importar desde Clientes/Empresas de AxyCore.
                    </td>
                  </tr>
                ) : (
                  filteredReceivers.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 dark:border-white/5">
                      <td className="py-2.5 px-3 font-semibold">{r.partyRole}</td>
                      <td className="py-2.5 px-3">{r.idType}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#0052CC] dark:text-[#00D1FF]">
                        {r.taxId}
                      </td>
                      <td className="py-2.5 px-3 font-semibold">{r.legalName}</td>
                      <td className="py-2.5 px-3">{r.taxRegime}</td>
                      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">
                        {r.email || '—'} {r.phone ? `· ${r.phone}` : ''}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditReceiver(r)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/10 font-semibold cursor-pointer"
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200/85 dark:border-[#00B8FF]/20 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-[#040C1E] border-b border-slate-200 dark:border-white/10 text-[11px] uppercase text-slate-500">
                  <th className="py-2.5 px-3">SKU</th>
                  <th className="py-2.5 px-3">Nombre</th>
                  <th className="py-2.5 px-3">Tipo</th>
                  <th className="py-2.5 px-3 text-right">Precio Unit.</th>
                  <th className="py-2.5 px-3">ITBIS</th>
                  <th className="py-2.5 px-3">Cuenta Ingreso / Gasto</th>
                  <th className="py-2.5 px-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400">
                      Sin productos o servicios configurados todavía.
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 dark:border-white/5">
                      <td className="py-2.5 px-3 font-mono font-bold">{p.sku}</td>
                      <td className="py-2.5 px-3 font-semibold">{p.name}</td>
                      <td className="py-2.5 px-3">{p.itemType}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatMoney(p.unitPrice, p.currency)}</td>
                      <td className="py-2.5 px-3">{p.isExempt ? 'Exento (0%)' : `${p.itbisRate}%`}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-500 dark:text-slate-400">
                        {p.incomeAccountCode} / {p.expenseAccountCode}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => openEditProduct(p)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/10 font-semibold cursor-pointer"
                          >
                            Editar
                          </button>
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

      {/* Receiver Modal */}
      {recModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveReceiver}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/30 p-5 space-y-3 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                <span>{editingRec ? 'Editar Receptor Fiscal' : 'Nuevo Receptor Fiscal'}</span>
              </h3>
              <button type="button" onClick={() => setRecModalOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold mb-1">Rol</label>
                <select
                  value={partyRole}
                  onChange={(e) => setPartyRole(e.target.value as DgiiReceiverRecord['partyRole'])}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                >
                  <option value="CLIENTE">Cliente</option>
                  <option value="PROVEEDOR">Proveedor</option>
                  <option value="AMBOS">Ambos</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Tipo Identificación</label>
                <select
                  value={idType}
                  onChange={(e) => setIdType(e.target.value as DgiiReceiverRecord['idType'])}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                >
                  <option value="RNC">RNC (9 dígitos)</option>
                  <option value="CEDULA">Cédula (11 dígitos)</option>
                  <option value="PASAPORTE">Pasaporte</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">RNC / Cédula</label>
                <input
                  required
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Régimen Tributario</label>
                <select
                  value={taxRegime}
                  onChange={(e) => setTaxRegime(e.target.value as DgiiReceiverRecord['taxRegime'])}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                >
                  <option value="ORDINARIO">Ordinario</option>
                  <option value="PST">RST / Simplificado</option>
                  <option value="ZONA_FRANCA">Zona Franca / Régimen Especial</option>
                  <option value="GUBERNAMENTAL">Gubernamental</option>
                  <option value="EXTERIOR">Exterior</option>
                  <option value="CONSUMIDOR_FINAL">Consumidor Final</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold mb-1">Razón Social / Nombre</label>
                <input
                  required
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold mb-1">Dirección Fiscal</label>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Correo Electrónico</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Teléfono</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRecModalOpen(false)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                Guardar Receptor
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Product Modal */}
      {prodModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveProduct}
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#08132B] border border-slate-200 dark:border-[#00B8FF]/30 p-5 space-y-3 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Package className="w-4 h-4 text-[#0066FF] dark:text-[#00B8FF]" />
                <span>{editingProd ? 'Editar Producto / Servicio' : 'Nuevo Producto / Servicio'}</span>
              </h3>
              <button type="button" onClick={() => setProdModalOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold mb-1">SKU</label>
                <input
                  required
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Tipo</label>
                <select
                  value={itemType}
                  onChange={(e) => setItemType(e.target.value as 'BIEN' | 'SERVICIO')}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                >
                  <option value="SERVICIO">Servicio</option>
                  <option value="BIEN">Bien</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold mb-1">Nombre del Ítem</label>
                <input
                  required
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Precio Unitario</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E] font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">ITBIS</label>
                <select
                  value={isExempt ? 0 : itbisRate}
                  onChange={(e) => {
                    const r = Number(e.target.value) as EcfItbisRate;
                    setItbisRate(r);
                    setIsExempt(r === 0);
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                >
                  <option value={18}>18%</option>
                  <option value={16}>16%</option>
                  <option value={0}>Exento (0%)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Cuenta Ingreso (607)</label>
                <select
                  value={incomeAccountCode}
                  onChange={(e) => setIncomeAccountCode(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                >
                  <option value="4101">4101 · Ingresos Ventas</option>
                  {postableAccounts.map((a) => (
                    <option key={a.id} value={a.code}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1">Cuenta Costo/Gasto (606)</label>
                <select
                  value={expenseAccountCode}
                  onChange={(e) => setExpenseAccountCode(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#040C1E]"
                >
                  <option value="5101">5101 · Compras / Costos</option>
                  {postableAccounts.map((a) => (
                    <option key={a.id} value={a.code}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setProdModalOpen(false)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-white/10 font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-xl axy-brand-gradient text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                Guardar Ítem
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
