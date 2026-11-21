import type {
  AmortizationMethod,
  CollectionAccountRecord,
  CollectionActionRecord,
  CollectionChannel,
  CollectionContactResult,
  CurrencyCode,
  CustomerRecord,
  LoanInstallmentRecord,
  LoanRecord,
  PaymentChannelMethod,
  PaymentFrequency,
  PaymentPromiseRecord,
  PaymentRecord,
  PaymentStatus,
  ProductCode,
} from '../types/axycore';

export interface RawAppSheetDataset {
  customers: Array<Record<string, unknown>>;
  loans: Array<Record<string, unknown>>;
  installments: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  promises: Array<Record<string, unknown>>;
  applications?: Array<Record<string, unknown>>;
  collectionAccounts?: Array<Record<string, unknown>>;
}

export interface MigrationWarningItem {
  entity: 'CUSTOMER' | 'LOAN' | 'INSTALLMENT' | 'PAYMENT' | 'ACTION' | 'PROMISE' | 'RECONCILIATION';
  rowIndex: number;
  rawId?: string;
  reason: string;
}

export interface PortfolioCurrencyAuditTotals {
  currency: CurrencyCode;
  totalLoans: number;
  activeLoansCount: number;
  overdueLoansCount: number;
  paidLoansCount: number;
  cancelledLoansCount: number;
  activePortfolioCapital: number;
  approvedPrincipalActive: number;
  appliedPaymentsTotal: number;
  pendingPaymentsTotal: number;
}

export interface PreparedAppSheetMigrationPlan {
  organizationId: string;
  generatedAtIso: string;
  customers: Array<Omit<CustomerRecord, 'createdAt' | 'updatedAt'>>;
  loans: Array<Omit<LoanRecord, 'createdAt' | 'updatedAt'>>;
  installments: Array<Omit<LoanInstallmentRecord, 'createdAt' | 'updatedAt'>>;
  payments: Array<Omit<PaymentRecord, 'createdAt' | 'updatedAt'>>;
  actions: Array<Omit<CollectionActionRecord, 'createdAt'>>;
  promises: Array<Omit<PaymentPromiseRecord, 'createdAt' | 'updatedAt'>>;
  warnings: MigrationWarningItem[];
  summary: {
    customersTotal: number;
    loansTotal: number;
    installmentsTotal: number;
    paymentsTotal: number;
    actionsTotal: number;
    promisesTotal: number;
    warningsCount: number;
    dop: PortfolioCurrencyAuditTotals;
    usd: PortfolioCurrencyAuditTotals;
  };
}

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function normalizeHeaderKey(key: string): string {
  return key
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function sanitizeFirestoreDocId(prefix: string, rawKey: string): string {
  const cleaned = rawKey
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  // Deterministic short FNV-1a hash prevents collisions if two raw IDs sanitize identically
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawKey.length; i += 1) {
    hash ^= rawKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hashHex = (hash >>> 0).toString(36);
  const core = `${prefix}_${cleaned || 'row'}_${hashHex}`;
  return core.slice(0, 120);
}

function buildRowLookup(row: Record<string, unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) {
    const nk = normalizeHeaderKey(k);
    if (!map.has(nk) || (map.get(nk) === '' && v !== '')) {
      map.set(nk, v);
    }
  }
  return map;
}

function pickValue(lookup: Map<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    const val = lookup.get(normalizeHeaderKey(alias));
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return val;
    }
  }
  return undefined;
}

function pickString(lookup: Map<string, unknown>, aliases: string[], fallback = ''): string {
  const val = pickValue(lookup, aliases);
  if (val === undefined || val === null) return fallback;
  return String(val).trim();
}

export function parseFlexibleNumber(raw: unknown): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : 0;
  }
  if (raw === undefined || raw === null) return 0;
  let str = String(raw).trim();
  if (!str) return 0;

  const isNegative = (str.startsWith('(') && str.endsWith(')')) || str.startsWith('-');
  str = str.replace(/[^0-9.,]/g, '');
  if (!str) return 0;

  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      // European / LatAm "12.345,67"
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // Standard "12,345.67"
      str = str.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const decimalsLen = str.length - lastComma - 1;
    if (decimalsLen === 2 || decimalsLen === 1) {
      str = str.replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  }

  const parsed = Number.parseFloat(str);
  if (!Number.isFinite(parsed)) return 0;
  return isNegative ? -Math.abs(parsed) : parsed;
}

export function parseFlexibleDateIso(
  raw: unknown,
  fallbackIso: string,
  slashOrder: 'MDY' | 'DMY' = 'MDY'
): string {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallbackIso;
  const s = String(raw).trim();

  // YYYY-MM-DD or ISO timestamp
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // MM/DD/YYYY (AppSheet API JSON default even with es-DO locale) or DD/MM/YYYY
  const slashMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const b = Number(slashMatch[2]);
    const y = slashMatch[3];
    let day = b;
    let month = a;
    if (a > 12 && b <= 12) {
      // Unambiguously DD/MM/YYYY
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      // Unambiguously MM/DD/YYYY
      month = a;
      day = b;
    } else if (slashOrder === 'DMY') {
      day = a;
      month = b;
    } else {
      month = a;
      day = b;
    }
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return fallbackIso;
}

function normalizeCurrency(raw: string): CurrencyCode {
  const up = raw.toUpperCase();
  if (up.includes('USD') || up.includes('US$') || up.includes('DOLAR')) return 'USD';
  return 'DOP';
}

function normalizeFrequency(raw: string): PaymentFrequency {
  const up = raw.toUpperCase();
  if (up.includes('DIAR') || up.includes('DAILY')) return 'DIARIA';
  if (up.includes('SEMAN') || up.includes('WEEK')) return 'SEMANAL';
  if (up.includes('QUINC') || up.includes('BIWEEK')) return 'QUINCENAL';
  return 'MENSUAL';
}

function normalizeAmortizationMethod(raw: string): AmortizationMethod {
  const up = raw.toUpperCase();
  if (up.includes('FIJ') || up.includes('FLAT') || up.includes('FIXED')) return 'INTERES_FIJO';
  return 'SALDO_INSOLUTO';
}

function normalizeLoanStatus(
  raw: string,
  remainingPrincipal: number,
  hasOverdueInstallments = false
): LoanRecord['status'] {
  const up = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  if (up.includes('CANCEL') || up.includes('ANUL') || up.includes('CASTIG')) return 'CANCELADO';
  // Respect explicit PAGADO / SALDADO / LIQUIDADO / CERRADO from AppSheet even if a stale balance column exists
  if (up.includes('PAGAD') || up.includes('SALDAD') || up.includes('LIQUID') || up.includes('CERRAD')) {
    return 'PAGADO';
  }
  if (up.includes('VENC') || up.includes('MOR') || up.includes('ATRAS') || up.includes('LEGAL')) {
    return 'VENCIDO';
  }
  if (remainingPrincipal <= 0.01 && up === '') return 'PAGADO';
  if (hasOverdueInstallments) return 'VENCIDO';
  return 'ACTIVO';
}

function normalizeInstallmentStatus(raw: string, totalDue: number, paidTotal: number): LoanInstallmentRecord['status'] {
  const up = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  if (up.includes('PAGAD') || up.includes('SALDAD') || up.includes('PAID')) return 'PAGADA';
  if (up.includes('PARCI') || up.includes('ABON')) return 'PARCIAL';
  if (up.includes('VENC') || up.includes('MOR') || up.includes('ATRAS')) return 'VENCIDA';
  if (totalDue > 0 && paidTotal >= totalDue - 0.05) return 'PAGADA';
  if (paidTotal > 0.05) return 'PARCIAL';
  return 'PENDIENTE';
}

function normalizePaymentStatus(
  rawStatus: string,
  rawAppliedFlag = '',
  rawMovementType = ''
): PaymentStatus {
  const mov = rawMovementType
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  if (mov.includes('ANUL') || mov.includes('REVERT')) return 'REVERTIDO';

  const appFlag = rawAppliedFlag.trim().toUpperCase();
  if (appFlag === 'Y' || appFlag === 'YES' || appFlag === 'SI' || appFlag === 'TRUE' || appFlag === '1') {
    return 'APLICADO';
  }
  if (appFlag === 'N' || appFlag === 'NO' || appFlag === 'FALSE' || appFlag === '0') {
    return 'RECIBIDO_PENDIENTE_VERIFICACION';
  }

  const up = rawStatus
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  if (up.includes('REVERT') || up.includes('ANUL')) return 'REVERTIDO';
  if (up.includes('RECHAZ')) return 'RECHAZADO';
  if (up.includes('PEND') || up.includes('REPORT')) return 'RECIBIDO_PENDIENTE_VERIFICACION';
  if (up.includes('VERIF')) return 'VERIFICADO';
  return 'APLICADO';
}

function normalizePaymentMethod(raw: string): PaymentChannelMethod {
  const up = raw.toUpperCase();
  if (up.includes('TRANSF')) return 'TRANSFERENCIA';
  if (up.includes('DEPOS')) return 'DEPOSITO';
  if (up.includes('TARJ')) return 'TARJETA';
  if (up.includes('CHEQ')) return 'CHEQUE';
  if (up.includes('LINK')) return 'LINK_PAGO';
  if (up.includes('EFECT') || up.includes('CAJA') || up.includes('CASH')) return 'CAJA_EFECTIVO';
  return 'OTRO';
}

function normalizeCollectionChannel(raw: string): CollectionChannel {
  const up = raw.toUpperCase();
  if (up.includes('WHATS')) return 'WHATSAPP';
  if (up.includes('VISIT') || up.includes('CAMPO')) return 'VISITA_CAMPO';
  if (up.includes('SMS')) return 'SMS';
  if (up.includes('EMAIL') || up.includes('CORREO')) return 'EMAIL';
  if (up.includes('OFIC')) return 'OFICINA';
  return 'LLAMADA';
}

function normalizeContactResult(raw: string): CollectionContactResult {
  const up = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  if (up.includes('PROMES') || up.includes('COMPROM')) return 'CONTACTO_EFECTIVO_PROMESA';
  if (up.includes('REESTRUCT') || up.includes('ACUERD')) return 'SOLICITA_REESTRUCTURACION';
  if (up.includes('RECLAM')) return 'RECLAMACION_CLIENTE';
  if (up.includes('BUZON')) return 'BUZON';
  if (up.includes('EQUIVOC') || up.includes('INACT')) return 'NUMERO_EQUIVOCADO_O_INACTIVO';
  if (up.includes('NO CONT')) return 'NO_CONTESTA';
  return 'CONTACTO_SIN_ACUERDO';
}

function normalizeRateMonthlyDecimal(raw: unknown): number {
  const n = parseFlexibleNumber(raw);
  if (n <= 0) return 0;
  // Values >= 1 are interpreted as percentage (e.g. 5 -> 0.05)
  return n >= 1 ? Number((n / 100).toFixed(6)) : Number(n.toFixed(6));
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 7) return trimmed.slice(0, 40);
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 7) return digits.slice(0, 40);
  return '000-000-0000';
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const clean = fullName.trim().replace(/\s+/g, ' ');
  if (!clean) return { firstName: 'Cliente', lastName: 'Migrado' };
  const parts = clean.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: 'AppSheet' };
  const half = Math.ceil(parts.length / 2);
  return {
    firstName: parts.slice(0, half).join(' ').slice(0, 120),
    lastName: parts.slice(half).join(' ').slice(0, 120),
  };
}

function buildCurrencySummary(
  currency: CurrencyCode,
  loans: Array<Omit<LoanRecord, 'createdAt' | 'updatedAt'>>,
  payments: Array<Omit<PaymentRecord, 'createdAt' | 'updatedAt'>>
): PortfolioCurrencyAuditTotals {
  const curLoans = loans.filter((l) => l.currency === currency);
  const activeLoans = curLoans.filter((l) => l.status === 'ACTIVO' || l.status === 'VENCIDO');
  const curPayments = payments.filter((p) => p.currency === currency);
  const appliedTotal = curPayments
    .filter((p) => p.status === 'APLICADO')
    .reduce((s, p) => s + p.amount, 0);
  const pendingTotal = curPayments
    .filter((p) => p.status === 'REPORTADO' || p.status === 'RECIBIDO_PENDIENTE_VERIFICACION' || p.status === 'VERIFICADO')
    .reduce((s, p) => s + p.amount, 0);

  return {
    currency,
    totalLoans: curLoans.length,
    activeLoansCount: curLoans.filter((l) => l.status === 'ACTIVO').length,
    overdueLoansCount: curLoans.filter((l) => l.status === 'VENCIDO').length,
    paidLoansCount: curLoans.filter((l) => l.status === 'PAGADO').length,
    cancelledLoansCount: curLoans.filter((l) => l.status === 'CANCELADO').length,
    activePortfolioCapital: round2(
      activeLoans.reduce((s, l) => s + Number(l.currentPrincipalBalance || 0), 0)
    ),
    approvedPrincipalActive: round2(
      activeLoans.reduce((s, l) => s + Number(l.approvedPrincipal || 0), 0)
    ),
    appliedPaymentsTotal: round2(appliedTotal),
    pendingPaymentsTotal: round2(pendingTotal),
  };
}

export function prepareAppSheetMigrationPlan(params: {
  dataset: RawAppSheetDataset;
  organizationId: string;
  actorUid: string;
  actorName: string;
  todayIso?: string;
  existingCustomers?: CustomerRecord[];
  existingLoans?: LoanRecord[];
}): PreparedAppSheetMigrationPlan {
  const {
    dataset,
    organizationId,
    actorUid,
    actorName,
    todayIso = new Date().toISOString().slice(0, 10),
    existingCustomers = [],
    existingLoans = [],
  } = params;

  const warnings: MigrationWarningItem[] = [];

  // Lookup indices for deduping & cross-table resolution
  const custById = new Map<string, Omit<CustomerRecord, 'createdAt' | 'updatedAt'>>();
  const custByRawKey = new Map<string, string>(); // raw key / documentKey / docNumber / normalized name -> Firestore customerId

  for (const existingCust of existingCustomers) {
    custById.set(existingCust.id, existingCust);
    if (existingCust.documentKey) custByRawKey.set(existingCust.documentKey.toUpperCase(), existingCust.id);
    if (existingCust.documentNumber) {
      custByRawKey.set(existingCust.documentNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(), existingCust.id);
    }
    const full = `${existingCust.firstName} ${existingCust.lastName}`.trim().toLowerCase();
    if (full) custByRawKey.set(`name:${full}`, existingCust.id);
  }

  // 1. CUSTOMERS (deduplicated by customerId / real cedula so Firestore never gets duplicate batch writes)
  const customersOutById = new Map<string, Omit<CustomerRecord, 'createdAt' | 'updatedAt'>>();
  dataset.customers.forEach((rawRow, idx) => {
    const lookup = buildRowLookup(rawRow);
    const rawId = pickString(lookup, [
      'id',
      'customerId',
      'id_cliente',
      'idcliente',
      'cliente_id',
      'codigo',
      'codigo_cliente',
      'Row ID',
    ]);
    const docNumRaw = pickString(lookup, [
      'documentNumber',
      'cedula',
      'rnc',
      'documento',
      'numero_documento',
      'identificacion',
      'dni',
      'pasaporte',
    ]);
    const cleanDocNum = (docNumRaw || rawId || `MIG-${idx + 1}`)
      .trim()
      .slice(0, 40)
      .padEnd(5, '0');
    const docDigits = cleanDocNum.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const docType: 'CEDULA' | 'PASAPORTE' = pickString(lookup, ['documentType', 'tipo_documento'])
      .toUpperCase()
      .includes('PASA')
      ? 'PASAPORTE'
      : 'CEDULA';
    const docKey = `${organizationId}_${docType}_${docDigits}`.slice(0, 180);

    const firstRaw = pickString(lookup, ['firstName', 'nombres', 'nombre', 'primer_nombre']);
    const lastRaw = pickString(lookup, ['lastName', 'apellidos', 'apellido', 'primer_apellido']);
    const combinedFull = pickString(lookup, [
      'fullName',
      'nombre_completo',
      'cliente',
      'nombre_cliente',
      'applicantDisplayName',
    ]);

    let firstName = firstRaw.slice(0, 120);
    let lastName = lastRaw.slice(0, 120);
    if (!firstName || !lastName) {
      const split = splitFullName(combinedFull || `${firstRaw} ${lastRaw}`.trim());
      if (!firstName) firstName = split.firstName;
      if (!lastName) lastName = split.lastName;
    }

    const existingId =
      (rawId ? custByRawKey.get(`raw:${rawId.toLowerCase()}`) : undefined) ||
      custByRawKey.get(docKey.toUpperCase()) ||
      (docDigits ? custByRawKey.get(docDigits) : undefined);

    const customerId =
      existingId ||
      sanitizeFirestoreDocId('cust_as', rawId || docDigits || `${firstName}_${lastName}_${idx + 1}`);

    const rawRowId = pickString(lookup, ['Row ID']);
    const phonePrimary = pickString(lookup, ['phone', 'telefono', 'celular', 'whatsapp', 'movil', 'tel']);
    const phone = normalizePhone(phonePrimary);
    const whatsappAlt = pickString(lookup, ['whatsapp', 'altPhone', 'telefono_alterno']);
    const altPhone =
      whatsappAlt && whatsappAlt.trim() !== phonePrimary.trim() ? whatsappAlt.trim().slice(0, 40) : '';
    const emailRaw = pickString(lookup, ['email', 'correo', 'correo_electronico']).slice(0, 254);
    const birthDateRaw = pickString(lookup, ['birthDate', 'fecha_nacimiento']);
    const birthDate = birthDateRaw ? parseFlexibleDateIso(birthDateRaw, '') : '';
    const nationality = pickString(lookup, ['nationality', 'nacionalidad']).slice(0, 80);
    const maritalStatus = pickString(lookup, ['maritalStatus', 'estado_civil']).slice(0, 40);
    const housingRaw = pickString(lookup, ['housingType', 'tipo_vivienda']).toUpperCase();
    const housingType: CustomerRecord['housingType'] | undefined = housingRaw.includes('PROPI')
      ? 'PROPIA'
      : housingRaw.includes('ALQUIL')
      ? 'ALQUILADA'
      : housingRaw.includes('FAMIL')
      ? 'FAMILIAR'
      : housingRaw
      ? 'OTRA'
      : undefined;
    const residenceMonthsRaw = parseFlexibleNumber(pickValue(lookup, ['residenceMonths', 'tiempo_residencia_meses']));

    const record: Omit<CustomerRecord, 'createdAt' | 'updatedAt'> = {
      id: customerId,
      organizationId,
      documentType: docType,
      documentNumber: cleanDocNum,
      documentKey: docKey,
      firstName: firstName || 'Cliente',
      lastName: lastName || 'AppSheet',
      phone,
      ...(altPhone ? { altPhone } : {}),
      ...(emailRaw ? { email: emailRaw } : {}),
      ...(birthDate ? { birthDate: birthDate.slice(0, 20) } : {}),
      ...(nationality ? { nationality } : {}),
      ...(maritalStatus ? { maritalStatus } : {}),
      ...(housingType ? { housingType } : {}),
      ...(residenceMonthsRaw > 0 && residenceMonthsRaw <= 1200 ? { residenceMonths: Math.round(residenceMonthsRaw) } : {}),
      ...(pickString(lookup, ['address', 'direccion'])
        ? { address: pickString(lookup, ['address', 'direccion']).slice(0, 300) }
        : {}),
      ...(pickString(lookup, ['province', 'provincia'])
        ? { province: pickString(lookup, ['province', 'provincia']).slice(0, 100) }
        : {}),
      ...(pickString(lookup, ['municipality', 'municipio', 'ciudad', 'sector'])
        ? { municipality: pickString(lookup, ['municipality', 'municipio', 'ciudad', 'sector']).slice(0, 100) }
        : {}),
      createdBy: existingCustOwner(existingCustomers, customerId) || actorUid,
    };

    const prevMerged = customersOutById.get(customerId);
    const mergedRecord: Omit<CustomerRecord, 'createdAt' | 'updatedAt'> = prevMerged
      ? {
          ...prevMerged,
          phone: prevMerged.phone !== '000-000-0000' ? prevMerged.phone : record.phone,
          altPhone: prevMerged.altPhone || record.altPhone,
          email: prevMerged.email || record.email,
          birthDate: prevMerged.birthDate || record.birthDate,
          nationality: prevMerged.nationality || record.nationality,
          maritalStatus: prevMerged.maritalStatus || record.maritalStatus,
          housingType: prevMerged.housingType || record.housingType,
          residenceMonths: prevMerged.residenceMonths || record.residenceMonths,
          address: prevMerged.address || record.address,
          province: prevMerged.province || record.province,
          municipality: prevMerged.municipality || record.municipality,
        }
      : record;

    custById.set(customerId, mergedRecord);
    customersOutById.set(customerId, mergedRecord);
    if (rawId) custByRawKey.set(`raw:${rawId.toLowerCase()}`, customerId);
    if (rawRowId) custByRawKey.set(`raw:${rawRowId.toLowerCase()}`, customerId);
    custByRawKey.set(docKey.toUpperCase(), customerId);
    if (docDigits) custByRawKey.set(docDigits, customerId);
    custByRawKey.set(`name:${`${firstName} ${lastName}`.trim().toLowerCase()}`, customerId);
  });
  const customersOut: Array<Omit<CustomerRecord, 'createdAt' | 'updatedAt'>> = Array.from(customersOutById.values());

  // Build SOLICITUDES enrichment index (provides MONEDA_PROPUESTA / MONEDA_SOLICITADA & TIPO_SOLICITUD for PRESTAMOS)
  const appMetaBySolicitudId = new Map<string, { currency: string; productHint: string }>();
  (dataset.applications || []).forEach((rawApp) => {
    const lookup = buildRowLookup(rawApp);
    const solId = pickString(lookup, ['ID_SOLICITUD', 'id_solicitud', 'id', 'Row ID']);
    if (!solId) return;
    const cur = pickString(lookup, ['MONEDA_PROPUESTA', 'MONEDA_SOLICITADA', 'moneda', 'currency']);
    const prod = pickString(lookup, ['TIPO_SOLICITUD', 'producto', 'productCode']);
    appMetaBySolicitudId.set(solId.toLowerCase(), { currency: cur, productHint: prod });
    const rowId = pickString(lookup, ['Row ID']);
    if (rowId) appMetaBySolicitudId.set(rowId.toLowerCase(), { currency: cur, productHint: prod });
  });

  // Build AppSheet Collection Accounts balance map (if CARTERA_COBRANZA table provided separately)
  const appSheetAccountBalanceByLoanKey = new Map<string, number>();
  (dataset.collectionAccounts || []).forEach((rawAcc) => {
    const lookup = buildRowLookup(rawAcc);
    const key = pickString(lookup, ['loanId', 'loanNumber', 'id_prestamo', 'prestamo', 'codigo_prestamo']);
    const bal = parseFlexibleNumber(
      pickValue(lookup, [
        'totalOutstandingPrincipal',
        'saldo_capital',
        'capital_pendiente',
        'balance_capital',
        'balance',
        'saldo',
      ])
    );
    if (key && bal > 0) {
      appSheetAccountBalanceByLoanKey.set(key.toLowerCase(), round2(bal));
    }
  });

  // Pre-parse installment balances grouped by raw loan reference to help recover missing loan balances
  const parsedRawInstallments: Array<{
    rowIndex: number;
    lookup: Map<string, unknown>;
    rawLoanRef: string;
    installmentNumber: number;
    dueDate: string;
    principalAmount: number;
    interestAmount: number;
    otherCharges: number;
    totalAmount: number;
    remainingPrincipalBalance: number;
    paidPrincipal: number;
    paidInterest: number;
    paidLateFee: number;
    accruedLateFee: number;
    status: LoanInstallmentRecord['status'];
    paidAt: string | null;
  }> = [];

  const unpaidInstallmentPrincipalByLoanRef = new Map<string, number>();
  const overdueInstallmentCountByLoanRef = new Map<string, number>();
  const installmentDateBoundsByLoanRef = new Map<string, { first: string; last: string }>();

  dataset.installments.forEach((rawInst, idx) => {
    const lookup = buildRowLookup(rawInst);
    const rawLoanRef = pickString(lookup, [
      'id_prestamo',
      'loanId',
      'loanNumber',
      'prestamo_id',
      'prestamo',
      'numero_prestamo',
      'codigo_prestamo',
    ]);
    if (!rawLoanRef) {
      warnings.push({
        entity: 'INSTALLMENT',
        rowIndex: idx + 1,
        reason: 'Cuota sin referencia de préstamo (loanId / numero_prestamo). Omitida.',
      });
      return;
    }

    const instNumRaw = Math.round(
      parseFlexibleNumber(pickValue(lookup, ['installmentNumber', 'numero_cuota', 'nro', 'numero']))
    );
    const installmentNumber = Math.min(360, Math.max(1, instNumRaw || idx + 1));
    const dueDate = parseFlexibleDateIso(
      pickValue(lookup, ['dueDate', 'fecha_vencimiento', 'fecha_cuota', 'fecha', 'vencimiento']),
      todayIso
    );

    const principalAmount = Math.max(
      0,
      round2(parseFlexibleNumber(pickValue(lookup, ['principalAmount', 'capital', 'amortizacion', 'capital_cuota'])))
    );
    const interestAmount = Math.max(
      0,
      round2(parseFlexibleNumber(pickValue(lookup, ['interestAmount', 'interes', 'intereses', 'interes_cuota'])))
    );
    const otherCharges = Math.max(
      0,
      round2(parseFlexibleNumber(pickValue(lookup, ['otherCharges', 'cargos', 'otros_cargos', 'seguro'])))
    );
    const rawTotal = Math.max(
      0,
      round2(
        parseFlexibleNumber(
          pickValue(lookup, ['totalAmount', 'monto_cuota', 'cuota_total', 'cuota', 'total', 'valor_cuota'])
        )
      )
    );
    const totalAmount = rawTotal > 0 ? rawTotal : round2(principalAmount + interestAmount + otherCharges);

    const paidPrincipal = Math.max(
      0,
      round2(parseFlexibleNumber(pickValue(lookup, ['paidPrincipal', 'capital_pagado', 'abono_capital'])))
    );
    const paidInterest = Math.max(
      0,
      round2(parseFlexibleNumber(pickValue(lookup, ['paidInterest', 'interes_pagado'])))
    );
    const paidLateFee = Math.max(
      0,
      round2(parseFlexibleNumber(pickValue(lookup, ['paidLateFee', 'mora_pagada'])))
    );
    const accruedLateFee = Math.max(
      0,
      round2(parseFlexibleNumber(pickValue(lookup, ['accruedLateFee', 'mora', 'mora_acumulada'])))
    );
    const paidTotal = paidPrincipal + paidInterest;
    const status = normalizeInstallmentStatus(
      pickString(lookup, ['status', 'estado', 'estatus']),
      totalAmount,
      paidTotal
    );

    const remainingPrincipalBalance = Math.max(
      0,
      round2(
        parseFlexibleNumber(
          pickValue(lookup, ['remainingPrincipalBalance', 'balance_capital', 'saldo_restante', 'balance'])
        )
      )
    );
    const paidAtRaw = pickString(lookup, ['paidAt', 'fecha_pago']);
    const refKey = rawLoanRef.toLowerCase();

    if (status !== 'PAGADA') {
      const pendingPrincipal = Math.max(0, round2(principalAmount - paidPrincipal));
      unpaidInstallmentPrincipalByLoanRef.set(
        refKey,
        round2((unpaidInstallmentPrincipalByLoanRef.get(refKey) || 0) + pendingPrincipal)
      );
    }
    if (status === 'VENCIDA') {
      overdueInstallmentCountByLoanRef.set(refKey, (overdueInstallmentCountByLoanRef.get(refKey) || 0) + 1);
    }

    const bounds = installmentDateBoundsByLoanRef.get(refKey);
    if (!bounds) {
      installmentDateBoundsByLoanRef.set(refKey, { first: dueDate, last: dueDate });
    } else {
      if (dueDate < bounds.first) bounds.first = dueDate;
      if (dueDate > bounds.last) bounds.last = dueDate;
    }

    parsedRawInstallments.push({
      rowIndex: idx + 1,
      lookup,
      rawLoanRef,
      installmentNumber,
      dueDate,
      principalAmount,
      interestAmount,
      otherCharges,
      totalAmount,
      remainingPrincipalBalance,
      paidPrincipal,
      paidInterest,
      paidLateFee,
      accruedLateFee,
      status,
      paidAt: paidAtRaw ? parseFlexibleDateIso(paidAtRaw, todayIso) : null,
    });
  });

  // 2. LOANS
  const loansOut: Array<Omit<LoanRecord, 'createdAt' | 'updatedAt'>> = [];
  const loanIdByRef = new Map<string, Omit<LoanRecord, 'createdAt' | 'updatedAt'>>();
  const existingLoanById = new Map(existingLoans.map((l) => [l.id, l]));
  const existingLoanByNum = new Map(existingLoans.map((l) => [l.loanNumber.trim().toLowerCase(), l]));

  dataset.loans.forEach((rawLoan, idx) => {
    const lookup = buildRowLookup(rawLoan);
    const rawLoanId = pickString(lookup, [
      'id_prestamo',
      'id',
      'loanId',
      'prestamo_id',
      'Row ID',
    ]);
    const loanNumber =
      pickString(lookup, ['loanNumber', 'numero_prestamo', 'codigo_prestamo', 'id_prestamo', 'codigo', 'contrato', 'id']) ||
      `PRE-AS-${String(idx + 1).padStart(4, '0')}`;

    const existingMatch =
      (rawLoanId ? existingLoanById.get(rawLoanId) : undefined) ||
      existingLoanByNum.get(loanNumber.trim().toLowerCase());

    const loanId = existingMatch?.id || sanitizeFirestoreDocId('loan_as', rawLoanId || loanNumber);

    // Resolve customer
    const rawCustRef = pickString(lookup, [
      'customerId',
      'id_cliente',
      'cliente_id',
      'codigo_cliente',
      'cedula',
      'documentNumber',
    ]);
    const applicantName = pickString(lookup, [
      'applicantDisplayName',
      'nombre_cliente',
      'cliente',
      'nombre',
      'deudor',
    ]);

    let resolvedCustomerId =
      (rawCustRef ? custByRawKey.get(`raw:${rawCustRef.toLowerCase()}`) : undefined) ||
      (rawCustRef
        ? custByRawKey.get(rawCustRef.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())
        : undefined) ||
      (applicantName ? custByRawKey.get(`name:${applicantName.trim().toLowerCase()}`) : undefined) ||
      existingMatch?.customerId ||
      '';

    // Synthesize missing customer safely if loan references one not in CLIENTES table
    if (!resolvedCustomerId) {
      const split = splitFullName(applicantName || `Cliente ${loanNumber}`);
      resolvedCustomerId = sanitizeFirestoreDocId(
        'cust_as',
        rawCustRef || applicantName || loanNumber
      );
      if (!custById.has(resolvedCustomerId)) {
        const docDigits = (rawCustRef || loanNumber).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().padEnd(6, '0');
        const synthCust: Omit<CustomerRecord, 'createdAt' | 'updatedAt'> = {
          id: resolvedCustomerId,
          organizationId,
          documentType: 'CEDULA',
          documentNumber: docDigits.slice(0, 40),
          documentKey: `${organizationId}_CEDULA_${docDigits}`.slice(0, 180),
          firstName: split.firstName,
          lastName: split.lastName,
          phone: normalizePhone(pickString(lookup, ['phone', 'telefono', 'celular'])),
          createdBy: actorUid,
        };
        custById.set(resolvedCustomerId, synthCust);
        if (rawCustRef) custByRawKey.set(`raw:${rawCustRef.toLowerCase()}`, resolvedCustomerId);
        if (applicantName) custByRawKey.set(`name:${applicantName.trim().toLowerCase()}`, resolvedCustomerId);
        custByRawKey.set(synthCust.documentKey.toUpperCase(), resolvedCustomerId);
        customersOut.push(synthCust);
        warnings.push({
          entity: 'CUSTOMER',
          rowIndex: idx + 1,
          rawId: resolvedCustomerId,
          reason: `Cliente sintetizado automáticamente desde préstamo ${loanNumber} (${applicantName || 'Sin nombre'}).`,
        });
      }
    }

    const matchedCust = custById.get(resolvedCustomerId);
    const displayName = (
      applicantName ||
      (matchedCust ? `${matchedCust.firstName} ${matchedCust.lastName}`.trim() : '') ||
      loanNumber
    ).slice(0, 200);

    const rawSolicitudId = pickString(lookup, ['ID_SOLICITUD', 'id_solicitud', 'applicationId']);
    const linkedSolMeta = rawSolicitudId ? appMetaBySolicitudId.get(rawSolicitudId.toLowerCase()) : undefined;
    const currency = normalizeCurrency(
      pickString(lookup, ['currency', 'moneda', 'divisa']) || linkedSolMeta?.currency || 'DOP'
    );

    const rawMontoContract = parseFlexibleNumber(
      pickValue(lookup, [
        'totalFinancedPrincipal',
        'capital_financiado',
        'monto_financiado',
        'monto_aprobado',
        'monto_prestamo',
        'monto',
        'capital_inicial',
        'capital',
      ])
    );
    const rawDisbursed = parseFlexibleNumber(
      pickValue(lookup, ['approvedPrincipal', 'monto_desembolsado', 'monto_entregado'])
    );
    const paidPrincipalTotal = Math.max(
      0,
      round2(
        parseFlexibleNumber(
          pickValue(lookup, ['paidPrincipalTotal', 'capital_recuperado', 'capital_pagado', 'total_abonado_capital'])
        )
      )
    );
    const rawBalance = parseFlexibleNumber(
      pickValue(lookup, [
        'currentPrincipalBalance',
        'capital_pendiente',
        'saldo_capital',
        'balance_capital',
        'saldo_pendiente',
        'saldo_actual',
        'balance_pendiente',
        'balance',
        'saldo',
      ])
    );

    const unpaidFromInst =
      unpaidInstallmentPrincipalByLoanRef.get(rawLoanId.toLowerCase()) ??
      unpaidInstallmentPrincipalByLoanRef.get(loanNumber.toLowerCase()) ??
      0;
    const balanceFromAcc =
      appSheetAccountBalanceByLoanKey.get(rawLoanId.toLowerCase()) ??
      appSheetAccountBalanceByLoanKey.get(loanNumber.toLowerCase()) ??
      0;

    let currentPrincipalBalance = round2(Math.max(0, rawBalance));
    if (currentPrincipalBalance <= 0 && balanceFromAcc > 0) {
      currentPrincipalBalance = balanceFromAcc;
    } else if (currentPrincipalBalance <= 0 && unpaidFromInst > 0) {
      currentPrincipalBalance = unpaidFromInst;
    }

    const totalFinancedPrincipal = round2(
      rawMontoContract > 0
        ? rawMontoContract
        : rawDisbursed > 0
        ? rawDisbursed
        : currentPrincipalBalance > 0
        ? currentPrincipalBalance
        : 0
    );

    const approvedPrincipal = round2(
      rawDisbursed > 0 && rawDisbursed <= totalFinancedPrincipal
        ? rawDisbursed
        : totalFinancedPrincipal
    );

    if (approvedPrincipal <= 0) {
      warnings.push({
        entity: 'LOAN',
        rowIndex: idx + 1,
        rawId: loanNumber,
        reason: `Préstamo ${loanNumber} omitido: monto aprobado/capital es <= 0 (regla Firestore exige approvedPrincipal > 0).`,
      });
      return;
    }

    const financedExpenses = Math.max(0, round2(totalFinancedPrincipal - approvedPrincipal));
    const overdueCountFromLoan = Math.round(
      parseFlexibleNumber(pickValue(lookup, ['cuotas_vencidas', 'overdueInstallments']))
    );
    const overdueCountFromInst =
      overdueInstallmentCountByLoanRef.get(rawLoanId.toLowerCase()) ??
      overdueInstallmentCountByLoanRef.get(loanNumber.toLowerCase()) ??
      0;

    const status = normalizeLoanStatus(
      pickString(lookup, ['status', 'estado', 'estatus', 'situacion']),
      currentPrincipalBalance,
      overdueCountFromLoan > 0 || overdueCountFromInst > 0
    );

    // If explicitly marked PAGADO or CANCELADO ensure 0 active principal balance
    if (status === 'PAGADO' || status === 'CANCELADO') {
      currentPrincipalBalance = 0;
    } else if (
      currentPrincipalBalance <= 0 &&
      paidPrincipalTotal === 0 &&
      rawBalance === 0 &&
      unpaidFromInst === 0
    ) {
      // Active loan imported without explicit saldo column falls back to totalFinancedPrincipal
      currentPrincipalBalance = totalFinancedPrincipal;
      warnings.push({
        entity: 'RECONCILIATION',
        rowIndex: idx + 1,
        rawId: loanNumber,
        reason: `Préstamo ${loanNumber} activo sin columna de saldo; se asignó saldo=${currentPrincipalBalance} igual al capital financiado.`,
      });
    }

    const rawProd = (
      pickString(lookup, ['productCode', 'producto', 'tipo_prestamo']) ||
      linkedSolMeta?.productHint ||
      ''
    ).toUpperCase();
    const isBusiness = rawProd.includes('EMPRES') || rawProd.includes('PYME') || rawProd.includes('NEGOC');
    const productCode: ProductCode =
      currency === 'USD'
        ? isBusiness
          ? 'EMPRESARIAL_USD'
          : 'PERSONAL_USD'
        : isBusiness
        ? 'EMPRESARIAL_DOP'
        : 'PERSONAL_DOP';

    const termMonths = Math.min(
      360,
      Math.max(
        1,
        Math.round(
          parseFlexibleNumber(pickValue(lookup, ['termMonths', 'plazo', 'plazo_meses', 'numero_cuotas', 'cuotas'])) || 12
        )
      )
    );
    const frequency = normalizeFrequency(
      pickString(lookup, ['frequency', 'frecuencia_pago', 'frecuencia', 'periodicidad'], 'MENSUAL')
    );
    const amortizationMethod = normalizeAmortizationMethod(
      pickString(lookup, ['amortizationMethod', 'metodo_amortizacion', 'tipo_interes'])
    );
    const contractualRateMonthly = normalizeRateMonthlyDecimal(
      pickValue(lookup, ['contractualRateMonthly', 'tasa_mensual', 'tasa', 'interes_mensual'])
    );

    const instBounds =
      installmentDateBoundsByLoanRef.get(rawLoanId.toLowerCase()) ||
      installmentDateBoundsByLoanRef.get(loanNumber.toLowerCase());

    const disbursementDate = parseFlexibleDateIso(
      pickValue(lookup, ['disbursementDate', 'fecha_desembolso', 'fecha_aprobacion', 'fecha_inicio', 'fecha']),
      instBounds?.first || todayIso
    );
    const firstPaymentDate = parseFlexibleDateIso(
      pickValue(lookup, ['firstPaymentDate', 'fecha_primer_pago', 'primer_pago']),
      instBounds?.first || disbursementDate
    );
    const maturityDate = parseFlexibleDateIso(
      pickValue(lookup, ['maturityDate', 'fecha_vencimiento', 'vencimiento']),
      instBounds?.last || disbursementDate
    );

    const paidInterestTotal = Math.max(
      0,
      round2(parseFlexibleNumber(pickValue(lookup, ['paidInterestTotal', 'interes_cobrado', 'interes_pagado'])))
    );
    const paidLateFeeTotal = Math.max(
      0,
      round2(parseFlexibleNumber(pickValue(lookup, ['paidLateFeeTotal', 'mora_cobrada', 'mora_pagada'])))
    );
    const totalContractualPayable = Math.max(
      totalFinancedPrincipal,
      round2(parseFlexibleNumber(pickValue(lookup, ['totalContractualPayable', 'total_a_pagar'])))
    );
    const rawTotalInt = round2(parseFlexibleNumber(pickValue(lookup, ['totalContractualInterest', 'interes_total'])));
    const totalContractualInterest = Math.max(
      0,
      rawTotalInt > 0 ? rawTotalInt : round2(totalContractualPayable - totalFinancedPrincipal)
    );

    const loanRecord: Omit<LoanRecord, 'createdAt' | 'updatedAt'> = {
      id: loanId,
      organizationId,
      loanNumber: loanNumber.slice(0, 64),
      applicationId: sanitizeFirestoreDocId('app_as', rawSolicitudId || rawLoanId || loanNumber),
      disbursementId: sanitizeFirestoreDocId('disb_as', rawLoanId || loanNumber),
      customerId: resolvedCustomerId,
      applicantDisplayName: displayName,
      productCode,
      currency,
      approvedPrincipal,
      financedExpenses,
      totalFinancedPrincipal,
      currentPrincipalBalance,
      contractualRateMonthly,
      termMonths,
      frequency,
      amortizationMethod,
      disbursementDate,
      firstPaymentDate,
      maturityDate,
      totalContractualInterest,
      totalContractualPayable,
      status,
      paidPrincipalTotal,
      paidInterestTotal,
      paidLateFeeTotal,
      ...(status === 'PAGADO' || status === 'CANCELADO'
        ? { closedAt: pickString(lookup, ['closedAt', 'fecha_cierre']) || todayIso }
        : {}),
      createdBy: existingMatch?.createdBy || actorUid,
    };

    loansOut.push(loanRecord);
    if (rawLoanId) loanIdByRef.set(rawLoanId.toLowerCase(), loanRecord);
    loanIdByRef.set(loanNumber.trim().toLowerCase(), loanRecord);
    loanIdByRef.set(loanId.toLowerCase(), loanRecord);
  });

  // Also index existing loans not in AppSheet loans sheet so installments/payments/actions still match!
  for (const el of existingLoans) {
    if (!loanIdByRef.has(el.id.toLowerCase())) loanIdByRef.set(el.id.toLowerCase(), el);
    if (!loanIdByRef.has(el.loanNumber.trim().toLowerCase())) {
      loanIdByRef.set(el.loanNumber.trim().toLowerCase(), el);
    }
  }

  // 3. INSTALLMENTS
  const installmentsOut: Array<Omit<LoanInstallmentRecord, 'createdAt' | 'updatedAt'>> = [];
  for (const item of parsedRawInstallments) {
    const matchedLoan = loanIdByRef.get(item.rawLoanRef.toLowerCase());
    if (!matchedLoan) {
      warnings.push({
        entity: 'INSTALLMENT',
        rowIndex: item.rowIndex,
        rawId: item.rawLoanRef,
        reason: `Cuota #${item.installmentNumber} omitida: no se encontró el préstamo "${item.rawLoanRef}".`,
      });
      continue;
    }

    const rawInstId = pickString(item.lookup, ['id', 'installmentId', 'id_cuota', 'Row ID']);
    const instId = sanitizeFirestoreDocId(
      'inst_as',
      rawInstId || `${matchedLoan.id}_c${item.installmentNumber}`
    );

    installmentsOut.push({
      id: instId,
      organizationId,
      loanId: matchedLoan.id,
      installmentNumber: item.installmentNumber,
      dueDate: item.dueDate.slice(0, 20),
      principalAmount: item.principalAmount,
      interestAmount: item.interestAmount,
      otherCharges: item.otherCharges,
      totalAmount: item.totalAmount,
      remainingPrincipalBalance: item.remainingPrincipalBalance,
      status: item.status,
      paidPrincipal: item.paidPrincipal,
      paidInterest: item.paidInterest,
      paidOtherCharges: 0,
      paidLateFee: item.paidLateFee,
      accruedLateFee: item.accruedLateFee,
      ...(item.paidAt ? { paidAt: item.paidAt } : {}),
    });
  }

  // 4. PAYMENTS
  const paymentsOut: Array<Omit<PaymentRecord, 'createdAt' | 'updatedAt'>> = [];
  dataset.payments.forEach((rawPay, idx) => {
    const lookup = buildRowLookup(rawPay);
    const rawLoanRef = pickString(lookup, [
      'loanId',
      'loanNumber',
      'id_prestamo',
      'prestamo',
      'numero_prestamo',
      'codigo_prestamo',
    ]);
    const matchedLoan = rawLoanRef ? loanIdByRef.get(rawLoanRef.toLowerCase()) : undefined;
    if (!matchedLoan) {
      warnings.push({
        entity: 'PAYMENT',
        rowIndex: idx + 1,
        rawId: rawLoanRef,
        reason: `Pago fila #${idx + 1} omitido: préstamo "${rawLoanRef || 'vacío'}" no encontrado.`,
      });
      return;
    }

    const amount = round2(
      parseFlexibleNumber(pickValue(lookup, ['amount', 'monto', 'monto_pagado', 'valor', 'total']))
    );
    if (amount <= 0) {
      warnings.push({
        entity: 'PAYMENT',
        rowIndex: idx + 1,
        rawId: rawLoanRef,
        reason: `Pago de préstamo ${matchedLoan.loanNumber} omitido: monto <= 0 (regla Firestore exige amount > 0).`,
      });
      return;
    }

    const rawPayId = pickString(lookup, ['id_pago', 'id', 'paymentId', 'recibo', 'Row ID']);
    const paymentDate = parseFlexibleDateIso(
      pickValue(lookup, ['paymentDate', 'fecha_pago', 'fecha']),
      todayIso
    );
    const appliedDate = parseFlexibleDateIso(
      pickValue(lookup, ['appliedDate', 'fecha_aplicacion']),
      paymentDate
    );
    const status = normalizePaymentStatus(
      pickString(lookup, ['status', 'estado', 'estatus', 'indicador de recuperacion']),
      pickString(lookup, ['aplicado']),
      pickString(lookup, ['tipo_movimiento'])
    );
    const payId = sanitizeFirestoreDocId(
      'pay_as',
      rawPayId || `${matchedLoan.id}_${paymentDate}_${amount}_${idx + 1}`
    );

    const principalPart = Math.max(
      0,
      round2(parseFlexibleNumber(pickValue(lookup, ['appliedPrincipal', 'capital_pagado', 'abono_capital'])))
    );
    const interestPart = Math.max(
      0,
      round2(parseFlexibleNumber(pickValue(lookup, ['appliedInterest', 'interes_pagado'])))
    );
    const lateFeePart = Math.max(
      0,
      round2(parseFlexibleNumber(pickValue(lookup, ['appliedLateFee', 'mora_pagada'])))
    );
    const hasBreakdown = principalPart > 0 || interestPart > 0 || lateFeePart > 0;

    const paymentRecord: Omit<PaymentRecord, 'createdAt' | 'updatedAt'> = {
      id: payId,
      organizationId,
      loanId: matchedLoan.id,
      loanNumber: matchedLoan.loanNumber,
      customerId: matchedLoan.customerId,
      customerName: matchedLoan.applicantDisplayName,
      currency: matchedLoan.currency,
      amount,
      paymentDate,
      method: normalizePaymentMethod(
        pickString(lookup, ['method', 'metodo_pago', 'metodo', 'forma_pago', 'canal'], 'CAJA_EFECTIVO')
      ),
      bankName: pickString(lookup, ['bankName', 'banco']),
      referenceNumber:
        pickString(lookup, ['referenceNumber', 'referencia', 'numero_recibo', 'recibo']) ||
        `AS-${idx + 1}`,
      idempotencyKey: `appsheet_pay_${payId}`,
      status,
      reportedByUserId: actorUid,
      reportedByName: pickString(lookup, ['reportedByName', 'registrado_por', 'cobrador', 'usuario'], actorName),
      ...(status === 'APLICADO'
        ? {
            appliedByUserId: actorUid,
            appliedByName: actorName,
            appliedAt: `${appliedDate}T12:00:00.000Z`,
            appliedDate,
            appliedBreakdown: hasBreakdown
              ? {
                  principal: principalPart,
                  interest: interestPart,
                  lateFee: lateFeePart,
                  otherCharges: Math.max(0, round2(amount - principalPart - interestPart - lateFeePart)),
                }
              : { principal: amount, interest: 0, lateFee: 0, otherCharges: 0 },
          }
        : {}),
      notes: pickString(lookup, ['notes', 'observacion', 'observaciones', 'comentario']),
    };

    paymentsOut.push(paymentRecord);
  });

  // 5. COLLECTION ACTIONS (GESTIONES / COBROS)
  const actionsOut: Array<Omit<CollectionActionRecord, 'createdAt'>> = [];
  dataset.actions.forEach((rawAct, idx) => {
    const lookup = buildRowLookup(rawAct);
    const rawLoanRef = pickString(lookup, [
      'id_prestamo',
      'loanId',
      'loanNumber',
      'prestamo',
      'numero_prestamo',
      'codigo_prestamo',
    ]);
    const matchedLoan = rawLoanRef ? loanIdByRef.get(rawLoanRef.toLowerCase()) : undefined;
    if (!matchedLoan) {
      warnings.push({
        entity: 'ACTION',
        rowIndex: idx + 1,
        rawId: rawLoanRef,
        reason: `Gestión fila #${idx + 1} omitida: préstamo "${rawLoanRef || 'vacío'}" no encontrado.`,
      });
      return;
    }

    const rawActId = pickString(lookup, ['id_gestion', 'id', 'actionId', 'id_cobro', 'Row ID']);
    const actionDate = parseFlexibleDateIso(
      pickValue(lookup, ['actionDate', 'fecha_gestion', 'fecha', 'fecha_cobro']),
      todayIso
    );
    const rawNotes =
      pickString(lookup, ['notes', 'observacion', 'notas', 'observaciones', 'comentario', 'detalle', 'resultado']) ||
      `Gestión importada de AppSheet (${matchedLoan.loanNumber})`;
    const safeNotes = rawNotes.length >= 2 ? rawNotes.slice(0, 4000) : `${rawNotes} - AppSheet`;
    const actionId = sanitizeFirestoreDocId('act_as', rawActId || `${matchedLoan.id}_${actionDate}_${idx + 1}`);
    const nextAction = pickString(lookup, ['nextActionDate', 'fecha_proxima_gestion', 'proximo_contacto', 'proxima_gestion']);

    actionsOut.push({
      id: actionId,
      organizationId,
      loanId: matchedLoan.id,
      loanNumber: matchedLoan.loanNumber,
      customerId: matchedLoan.customerId,
      customerName: matchedLoan.applicantDisplayName,
      collectorId: actorUid,
      collectorName: pickString(lookup, ['collectorName', 'responsable', 'gestor', 'cobrador', 'usuario'], actorName),
      channel: normalizeCollectionChannel(pickString(lookup, ['channel', 'tipo_gestion', 'canal', 'medio'], 'LLAMADA')),
      contactResult: normalizeContactResult(
        pickString(lookup, ['contactResult', 'resultado', 'estatus', 'respuesta'])
      ),
      notes: safeNotes,
      dpdAtAction: Math.max(0, Math.round(parseFlexibleNumber(pickValue(lookup, ['dpd', 'dias_atraso'])))),
      nextActionDate: nextAction ? parseFlexibleDateIso(nextAction, todayIso) : null,
      isClosed: true,
      actionTimeIso: `${actionDate}T12:00:00.000Z`,
    });
  });

  // 6. PAYMENT PROMISES / AGREEMENTS (ACUERDOS / PROMESAS)
  const promisesOut: Array<Omit<PaymentPromiseRecord, 'createdAt' | 'updatedAt'>> = [];
  dataset.promises.forEach((rawProm, idx) => {
    const lookup = buildRowLookup(rawProm);
    const rawLoanRef = pickString(lookup, [
      'id_prestamo',
      'loanId',
      'loanNumber',
      'prestamo',
      'numero_prestamo',
      'codigo_prestamo',
    ]);
    const matchedLoan = rawLoanRef ? loanIdByRef.get(rawLoanRef.toLowerCase()) : undefined;
    if (!matchedLoan) {
      warnings.push({
        entity: 'PROMISE',
        rowIndex: idx + 1,
        rawId: rawLoanRef,
        reason: `Acuerdo/Promesa fila #${idx + 1} omitida: préstamo "${rawLoanRef || 'vacío'}" no encontrado.`,
      });
      return;
    }

    const promisedAmount = round2(
      parseFlexibleNumber(pickValue(lookup, ['promisedAmount', 'monto_acordado', 'monto', 'monto_prometido', 'valor']))
    );
    if (promisedAmount <= 0) {
      warnings.push({
        entity: 'PROMISE',
        rowIndex: idx + 1,
        rawId: rawLoanRef,
        reason: `Acuerdo/Promesa de ${matchedLoan.loanNumber} omitida: monto <= 0.`,
      });
      return;
    }

    const rawPromId = pickString(lookup, ['id_acuerdo', 'id', 'promiseId', 'id_promesa', 'Row ID']);
    const promisedDate = parseFlexibleDateIso(
      pickValue(lookup, ['promisedDate', 'fecha_compromiso', 'fecha_promesa', 'fecha_acuerdo', 'fecha']),
      todayIso
    );
    const statusRaw = pickString(lookup, ['status', 'estado_acuerdo', 'estado', 'estatus']).toUpperCase();
    let status: PaymentPromiseRecord['status'] = 'VIGENTE';
    if (statusRaw.includes('CUMPL')) status = statusRaw.includes('PARC') ? 'CUMPLIDA_PARCIAL' : 'CUMPLIDA';
    else if (statusRaw.includes('INCUMPL')) status = 'INCUMPLIDA';
    else if (statusRaw.includes('CANCEL')) status = 'CANCELADA';
    else if (statusRaw.includes('VERIF')) status = 'PENDIENTE_VERIFICACION';

    const promId = sanitizeFirestoreDocId('prom_as', rawPromId || `${matchedLoan.id}_${promisedDate}_${idx + 1}`);
    promisesOut.push({
      id: promId,
      organizationId,
      loanId: matchedLoan.id,
      loanNumber: matchedLoan.loanNumber,
      customerId: matchedLoan.customerId,
      customerName: matchedLoan.applicantDisplayName,
      currency: matchedLoan.currency,
      promisedAmount,
      promisedDate,
      channel: normalizeCollectionChannel(pickString(lookup, ['channel', 'tipo_acuerdo', 'canal'], 'LLAMADA')),
      createdByUserId: actorUid,
      createdByUserName: pickString(lookup, ['createdByUserName', 'registrado_por', 'usuario'], actorName),
      status,
      fulfilledAmount: Math.max(
        0,
        round2(parseFlexibleNumber(pickValue(lookup, ['fulfilledAmount', 'monto_pagado_acuerdo', 'monto_cumplido'])))
      ),
      fulfilledPaymentIds: [],
      notes: pickString(lookup, ['notes', 'observacion', 'notas', 'observaciones']),
    });
  });

  return {
    organizationId,
    generatedAtIso: new Date().toISOString(),
    customers: customersOut,
    loans: loansOut,
    installments: installmentsOut,
    payments: paymentsOut,
    actions: actionsOut,
    promises: promisesOut,
    warnings,
    summary: {
      customersTotal: customersOut.length,
      loansTotal: loansOut.length,
      installmentsTotal: installmentsOut.length,
      paymentsTotal: paymentsOut.length,
      actionsTotal: actionsOut.length,
      promisesTotal: promisesOut.length,
      warningsCount: warnings.length,
      dop: buildCurrencySummary('DOP', loansOut, paymentsOut),
      usd: buildCurrencySummary('USD', loansOut, paymentsOut),
    },
  };
}

function existingCustOwner(existing: CustomerRecord[], id: string): string | undefined {
  return existing.find((c) => c.id === id)?.createdBy;
}

/**
 * Parses uploaded JSON array or RFC-4180 CSV text exported manually from AppSheet.
 */
export function parseAppSheetExportText(rawText: string): Array<Record<string, unknown>> {
  const trimmed = rawText.trim().replace(/^\uFEFF/, '');
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'));
    }
    if (parsed && typeof parsed === 'object' && 'Rows' in parsed && Array.isArray((parsed as { Rows?: unknown }).Rows)) {
      return (parsed as { Rows: unknown[] }).Rows.filter(
        (x): x is Record<string, unknown> => Boolean(x && typeof x === 'object')
      );
    }
    throw new Error('Formato JSON no reconocido. Debe ser un arreglo de filas o un objeto { Rows: [...] }.');
  }

  // CSV / TSV parser supporting quoted fields with embedded commas and newlines
  const delimiter = trimmed.split('\n')[0]?.includes('\t') && !trimmed.split('\n')[0]?.includes(',') ? '\t' : ',';
  const rows: string[][] = [];
  let curRow: string[] = [];
  let curCell = '';
  let inQuotes = false;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    const next = trimmed[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        curCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      curRow.push(curCell);
      curCell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      curRow.push(curCell);
      if (curRow.some((c) => c.trim() !== '')) rows.push(curRow);
      curRow = [];
      curCell = '';
    } else {
      curCell += ch;
    }
  }
  curRow.push(curCell);
  if (curRow.some((c) => c.trim() !== '')) rows.push(curRow);

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  const result: Array<Record<string, unknown>> = [];

  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    const obj: Record<string, unknown> = {};
    headers.forEach((h, cIdx) => {
      if (h) obj[h] = (cells[cIdx] ?? '').trim();
    });
    result.push(obj);
  }
  return result;
}
