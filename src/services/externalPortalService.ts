import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase/config';
import {
  buildCustomerDocumentKey,
  buildPhoneFormatCandidates,
  buildPublicPortalRecordFromOrg,
  computeIndicativePublicInstallment,
  normalizeDocumentDigits,
  normalizePortalCode,
  validatePublicCreditApplicationPayload,
  type PublicCreditApplicationInput,
} from '../engine/externalPortalEngine';
import { SU_GLORIA_MANO_AMIGA_ORG } from '../engine/multiTenantEngine';
import {
  buildCustomerDocId,
  generateId,
  saveBusinessUnique,
  saveCustomerUnique,
  submitOrSaveApplication,
  uploadDocumentRecord,
} from './axycoreStore';
import type {
  ApplicationRecord,
  ClientServiceRequestRecord,
  ClientServiceRequestStatus,
  ClientServiceRequestType,
  CreditPolicyRecord,
  CustomerRecord,
  FinancialAnalysisRecord,
  OrganizationRecord,
  PublicCreditApplicationRecord,
  PublicInstitutionPortalRecord,
  ScoringExecutionRecord,
  UserProfile,
} from '../types/axycore';

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

/**
 * Publishes or refreshes the PII-free public branding directory entry `public_portals/{portalCode}`
 * so clients visiting `/?portal=<portalCode>` immediately see the institution's identity before signing in.
 */
export async function syncPublicInstitutionPortal(
  org: OrganizationRecord,
  overrides?: {
    portalEnabled?: boolean;
    welcomeHeadline?: string;
    welcomeSubtitle?: string;
  }
): Promise<PublicInstitutionPortalRecord> {
  const prelim = buildPublicPortalRecordFromOrg(org, overrides);
  const portalRef = doc(db, 'public_portals', prelim.portalCode);

  let mergedOverrides = overrides;
  if (
    !overrides ||
    overrides.portalEnabled === undefined ||
    overrides.welcomeHeadline === undefined ||
    overrides.welcomeSubtitle === undefined
  ) {
    try {
      const existingSnap = await getDoc(portalRef);
      if (existingSnap.exists()) {
        const existingData = existingSnap.data() as PublicInstitutionPortalRecord;
        if (existingData.organizationId === org.id) {
          mergedOverrides = {
            portalEnabled:
              overrides?.portalEnabled !== undefined
                ? overrides.portalEnabled
                : existingData.portalEnabled,
            welcomeHeadline:
              overrides?.welcomeHeadline !== undefined
                ? overrides.welcomeHeadline
                : existingData.welcomeHeadline,
            welcomeSubtitle:
              overrides?.welcomeSubtitle !== undefined
                ? overrides.welcomeSubtitle
                : existingData.welcomeSubtitle,
          };
        }
      }
    } catch {
      // Proceed with defaults if existing doc is unreadable
    }
  }

  const base = buildPublicPortalRecordFromOrg(org, mergedOverrides);

  const payload = stripUndefined({
    ...base,
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(portalRef, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `public_portals/${base.portalCode}`);
  }

  return base;
}

/**
 * Resolves a public institution portal record by exact code (works before authentication).
 */
export async function fetchPublicInstitutionPortal(
  rawPortalCode: string
): Promise<PublicInstitutionPortalRecord | null> {
  const portalCode = normalizePortalCode(rawPortalCode);
  if (!portalCode) return null;

  try {
    const snap = await getDoc(doc(db, 'public_portals', portalCode));
    if (snap.exists()) {
      return snap.data() as PublicInstitutionPortalRecord;
    }
  } catch {
    // Fallback below if default institution portal hasn't been published yet
  }

  // Built-in fallback for primary institution SGMA-001 so its link works even before first admin sync
  const defaultCode = normalizePortalCode(SU_GLORIA_MANO_AMIGA_ORG.accessCode || 'SGMA-001');
  if (portalCode === defaultCode || portalCode === 'ORG_AXYCORE_MAIN') {
    return buildPublicPortalRecordFromOrg(SU_GLORIA_MANO_AMIGA_ORG);
  }

  return null;
}

export interface ExternalPortalValidationReport {
  portalCode: string;
  existsInFirestore: boolean;
  isActive: boolean;
  tenantIsolated: boolean;
  logoConfiguredOnOrg: boolean;
  logoSyncedInPortal: boolean;
  phoneSyncedInPortal: boolean;
  publishedRecord: PublicInstitutionPortalRecord | null;
}

/**
 * Live Firestore verification of an institution's external portal document and branding sync.
 */
export async function validatePublishedInstitutionPortal(
  org: OrganizationRecord,
  overridePortalCode?: string
): Promise<ExternalPortalValidationReport> {
  const portalCode =
    normalizePortalCode(overridePortalCode || org.accessCode || org.tenantId || org.id) ||
    'SGMA-001';
  let publishedRecord: PublicInstitutionPortalRecord | null = null;
  try {
    const snap = await getDoc(doc(db, 'public_portals', portalCode));
    if (snap.exists()) {
      publishedRecord = snap.data() as PublicInstitutionPortalRecord;
    }
  } catch {
    publishedRecord = null;
  }

  const orgLogo = (org.logoUrl || '').trim();
  const portalLogo = (publishedRecord?.logoUrl || '').trim();
  const orgPhone = (org.phone || '').trim();
  const portalPhone = (publishedRecord?.phone || '').trim();

  return {
    portalCode,
    existsInFirestore: Boolean(publishedRecord),
    isActive: Boolean(
      publishedRecord && publishedRecord.portalEnabled && publishedRecord.status === 'ACTIVA'
    ),
    tenantIsolated: Boolean(publishedRecord && publishedRecord.organizationId === org.id),
    logoConfiguredOnOrg: Boolean(orgLogo),
    logoSyncedInPortal: orgLogo ? portalLogo === orgLogo : !portalLogo,
    phoneSyncedInPortal: orgPhone ? portalPhone === orgPhone : true,
    publishedRecord,
  };
}

/**
 * Attempts to verify & link an authenticated EXTERNAL_CLIENT user to their existing
 * borrower record inside their institution using verified email OR exact cédula + phone match.
 */
export async function verifyAndLinkClientCustomerProfile(params: {
  user: UserProfile;
  organizationId: string;
  documentNumber?: string;
  documentType?: 'CEDULA' | 'PASAPORTE';
  phone?: string;
}): Promise<{
  linked: boolean;
  customer?: CustomerRecord;
  method?: 'VERIFIED_EMAIL' | 'CEDULA_AND_PHONE' | 'ALREADY_LINKED';
  message: string;
}> {
  const { user, organizationId, documentNumber, documentType = 'CEDULA', phone } = params;
  const userRef = doc(db, 'users', user.uid);

  // 1. Check if already linked to a valid customer in this institution
  if (user.linkedCustomerId) {
    const existingSnap = await getDoc(doc(db, 'customers', user.linkedCustomerId)).catch(() => null);
    if (existingSnap?.exists()) {
      const cust = existingSnap.data() as CustomerRecord;
      if (cust.organizationId === organizationId) {
        return {
          linked: true,
          customer: cust,
          method: 'ALREADY_LINKED',
          message: `Tu usuario ya está vinculado al expediente de ${cust.firstName} ${cust.lastName}.`,
        };
      }
    }
  }

  // 2. Try automatic verified-email match within the same institution
  const cleanEmail = (user.email || '').trim().toLowerCase();
  if (cleanEmail) {
    const emailMatches = await getDocs(
      query(
        collection(db, 'customers'),
        where('organizationId', '==', organizationId),
        where('email', '==', user.email.trim())
      )
    ).catch(() => null);

    const matchedByEmail = emailMatches?.docs[0]?.data() as CustomerRecord | undefined;
    if (matchedByEmail) {
      await updateDoc(userRef, {
        linkedCustomerId: matchedByEmail.id,
        updatedAt: serverTimestamp(),
      });
      return {
        linked: true,
        customer: matchedByEmail,
        method: 'VERIFIED_EMAIL',
        message: `Expediente verificado automáticamente por correo (${matchedByEmail.firstName} ${matchedByEmail.lastName}). Ya puedes ver tus préstamos y cuotas.`,
      };
    }
  }

  // 3. Try exact Cédula/Documento + Teléfono verification (Zero-Trust: rules verify both fields)
  const cleanDoc = (documentNumber || '').trim();
  const cleanPhone = (phone || '').trim();
  if (!cleanDoc || !cleanPhone) {
    return {
      linked: false,
      message:
        'Ingresa tu cédula/documento y el teléfono registrado en la institución para vincular tus préstamos.',
    };
  }

  const docKey = buildCustomerDocumentKey(organizationId, cleanDoc, documentType);
  const phoneCandidates = buildPhoneFormatCandidates(cleanPhone);

  for (const candidatePhone of phoneCandidates) {
    // Store declared pair on user profile so Firestore rules can validate the exact lookup
    await updateDoc(userRef, {
      declaredDocumentKey: docKey,
      declaredPhone: candidatePhone,
      updatedAt: serverTimestamp(),
    });

    const snap = await getDocs(
      query(
        collection(db, 'customers'),
        where('organizationId', '==', organizationId),
        where('documentKey', '==', docKey),
        where('phone', '==', candidatePhone)
      )
    ).catch(() => null);

    const matched = snap?.docs[0]?.data() as CustomerRecord | undefined;
    if (matched) {
      await updateDoc(userRef, {
        declaredDocumentKey: docKey,
        declaredPhone: candidatePhone,
        linkedCustomerId: matched.id,
        updatedAt: serverTimestamp(),
      });
      return {
        linked: true,
        customer: matched,
        method: 'CEDULA_AND_PHONE',
        message: `¡Identidad verificada! Vinculamos tu usuario al expediente de ${matched.firstName} ${matched.lastName}. Tus préstamos y cuotas aparecerán al instante.`,
      };
    }
  }

  return {
    linked: false,
    message:
      'No encontramos una coincidencia exacta con esa cédula y teléfono en esta institución. Puedes enviar una solicitud de "Vincular Préstamos Existentes" para que un oficial valide tu expediente en minutos.',
  };
}

/**
 * Allows internal institution staff to link a client's portal account (`users/{clientUid}`)
 * directly to their borrower record (`customers/{customerId}`).
 */
export async function staffLinkCustomerToPortalUser(params: {
  clientUid: string;
  customerId: string;
}): Promise<void> {
  const userRef = doc(db, 'users', params.clientUid);
  try {
    await updateDoc(userRef, {
      linkedCustomerId: params.customerId,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${params.clientUid}`);
  }
}

/**
 * Creates a tenant-isolated Client Service Request from the External Client Portal.
 */
export async function createClientServiceRequest(params: {
  user: UserProfile;
  organizationId: string;
  requestType: ClientServiceRequestType;
  subject: string;
  details: string;
  customerId?: string | null;
  loanId?: string | null;
  loanNumber?: string | null;
  requestedAmount?: number | null;
  requestedDate?: string | null;
  contactPhone?: string | null;
  documentNumber?: string | null;
}): Promise<ClientServiceRequestRecord> {
  const id = generateId('csreq');
  const seq = String(Date.now()).slice(-6);
  const ticketNumber = `REQ-${new Date().getFullYear()}-${seq}`;

  const record: ClientServiceRequestRecord = {
    id,
    ticketNumber,
    organizationId: params.organizationId,
    clientUid: params.user.uid,
    clientEmail: params.user.email.slice(0, 254),
    clientName: (params.user.displayName || params.user.email || 'Cliente').trim().slice(0, 160),
    ...(params.customerId ? { customerId: params.customerId } : {}),
    ...(params.loanId ? { loanId: params.loanId } : {}),
    ...(params.loanNumber ? { loanNumber: params.loanNumber.slice(0, 64) } : {}),
    requestType: params.requestType,
    subject: params.subject.trim().slice(0, 160),
    details: params.details.trim().slice(0, 2000),
    ...(typeof params.requestedAmount === 'number' && Number.isFinite(params.requestedAmount) && params.requestedAmount >= 0
      ? { requestedAmount: params.requestedAmount }
      : {}),
    ...(params.requestedDate?.trim() ? { requestedDate: params.requestedDate.trim().slice(0, 30) } : {}),
    ...(params.contactPhone?.trim() ? { contactPhone: params.contactPhone.trim().slice(0, 40) } : {}),
    ...(params.documentNumber?.trim() ? { documentNumber: params.documentNumber.trim().slice(0, 40) } : {}),
    status: 'PENDIENTE',
  };

  try {
    await setDoc(
      doc(db, 'client_service_requests', id),
      stripUndefined({
        ...record,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `client_service_requests/${id}`);
  }

  return record;
}

/**
 * Allows internal institution staff to respond to, update status, and optionally link a customer
 * on a Client Service Request.
 */
export async function respondToClientServiceRequest(params: {
  requestId: string;
  status: ClientServiceRequestStatus;
  staffResponse: string;
  staffUser: UserProfile;
  linkCustomerId?: string;
  clientUidToLink?: string;
}): Promise<void> {
  const { requestId, status, staffResponse, staffUser, linkCustomerId, clientUidToLink } = params;

  if (linkCustomerId && clientUidToLink) {
    await staffLinkCustomerToPortalUser({
      clientUid: clientUidToLink,
      customerId: linkCustomerId,
    });
  }

  const reqRef = doc(db, 'client_service_requests', requestId);
  try {
    await updateDoc(
      reqRef,
      stripUndefined({
        status,
        staffResponse: staffResponse.trim().slice(0, 2000),
        resolvedBy: staffUser.uid,
        resolvedByName: (staffUser.displayName || staffUser.email || 'Oficial').slice(0, 160),
        resolvedAt: new Date().toISOString().slice(0, 40),
        ...(linkCustomerId ? { customerId: linkCustomerId } : {}),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `client_service_requests/${requestId}`);
  }
}

/**
 * Updates an institution's unique external portal code (if changed) and publishes/syncs
 * its PII-free `public_portals/{portalCode}` directory document.
 */
export async function updateInstitutionPortalCodeAndSync(params: {
  org: OrganizationRecord;
  newPortalCode: string;
  portalEnabled: boolean;
  welcomeHeadline?: string;
  welcomeSubtitle?: string;
}): Promise<PublicInstitutionPortalRecord> {
  const { org, portalEnabled, welcomeHeadline, welcomeSubtitle } = params;
  const cleanNewCode = normalizePortalCode(params.newPortalCode);
  if (!cleanNewCode || cleanNewCode.length < 3) {
    throw new Error('El código del enlace externo debe tener al menos 3 caracteres alfanuméricos.');
  }

  const prevCode = normalizePortalCode(org.accessCode || org.tenantId || org.id);

  // Check collision with another institution's existing public portal
  const existingTarget = await getDoc(doc(db, 'public_portals', cleanNewCode)).catch(() => null);
  if (existingTarget?.exists()) {
    const existingPortal = existingTarget.data() as PublicInstitutionPortalRecord;
    if (existingPortal.organizationId !== org.id) {
      throw new Error(
        `El código "${cleanNewCode}" ya pertenece a otra institución (${existingPortal.tradeName || existingPortal.name}). Elige otro código único.`
      );
    }
  }

  // Update organization.accessCode when it changed
  if (cleanNewCode !== prevCode) {
    try {
      await updateDoc(doc(db, 'organizations', org.id), {
        accessCode: cleanNewCode,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `organizations/${org.id}`);
    }
  }

  const updatedOrg: OrganizationRecord = {
    ...org,
    accessCode: cleanNewCode,
  };

  const published = await syncPublicInstitutionPortal(updatedOrg, {
    portalEnabled,
    welcomeHeadline: welcomeHeadline?.trim() || undefined,
    welcomeSubtitle: welcomeSubtitle?.trim() || undefined,
  });

  // Disable old code document if it existed and differs from the new code
  if (prevCode && prevCode !== cleanNewCode) {
    const oldSnap = await getDoc(doc(db, 'public_portals', prevCode)).catch(() => null);
    if (oldSnap?.exists()) {
      const oldData = oldSnap.data() as PublicInstitutionPortalRecord;
      if (oldData.organizationId === org.id) {
        await setDoc(
          doc(db, 'public_portals', prevCode),
          stripUndefined({
            ...oldData,
            portalEnabled: false,
            updatedAt: serverTimestamp(),
          })
        ).catch(() => {});
      }
    }
  }

  return published;
}

/**
 * Fetches each registered institution's published `public_portals/{code}` document individually
 * (respecting the `allow list: if false` rule on `public_portals`).
 */
export async function fetchAllPublicPortalsForOrgs(
  orgs: OrganizationRecord[]
): Promise<Record<string, PublicInstitutionPortalRecord | null>> {
  const entries = await Promise.all(
    orgs.map(async (org) => {
      const code = normalizePortalCode(org.accessCode || org.tenantId || org.id);
      if (!code) return [org.id, null] as const;
      try {
        const snap = await getDoc(doc(db, 'public_portals', code));
        if (snap.exists()) {
          return [org.id, snap.data() as PublicInstitutionPortalRecord] as const;
        }
      } catch {
        // ignore missing or unreadable
      }
      return [org.id, null] as const;
    })
  );
  return Object.fromEntries(entries);
}

/**
 * Submits a PUBLIC (unauthenticated) credit application strictly bound to a single active institution.
 * Security is enforced in Firestore Rules via Master Gate validation against `public_portals/{portalCode}`.
 * Write-only for anonymous visitors (zero public reads of applicant PII).
 */
export async function submitPublicCreditApplication(params: {
  portal: PublicInstitutionPortalRecord;
  input: PublicCreditApplicationInput;
}): Promise<PublicCreditApplicationRecord> {
  const { portal, input } = params;
  if (!portal.portalEnabled || portal.status !== 'ACTIVA') {
    throw new Error('El portal público de esta institución no está habilitado para recibir solicitudes.');
  }

  const validation = validatePublicCreditApplicationPayload(input);
  if (!validation.valid || !validation.sanitized) {
    throw new Error(validation.errors[0] || 'Revisa los campos obligatorios de la solicitud.');
  }

  const clean = validation.sanitized;
  const indicative = computeIndicativePublicInstallment({
    amount: clean.requestedAmount,
    termMonths: clean.requestedTermMonths,
    frequency: clean.paymentFrequency,
  });

  const id = generateId('pubapp');
  const seq = String(Date.now()).slice(-6);
  const trackingNumber = `PUB-${new Date().getFullYear()}-${seq}`;
  const nowIso = new Date().toISOString();

  const record: PublicCreditApplicationRecord = {
    id,
    trackingNumber,
    organizationId: portal.organizationId,
    portalCode: portal.portalCode,
    institutionName: (portal.tradeName || portal.name || 'Institución').trim().slice(0, 160),
    applicantType: clean.applicantType || 'INDIVIDUAL',
    applicantFullName: clean.applicantFullName,
    documentType: clean.documentType,
    documentNumber: clean.documentNumber,
    phone: clean.phone,
    ...(clean.email ? { email: clean.email } : {}),
    ...(clean.address ? { address: clean.address } : {}),
    ...(clean.province ? { province: clean.province } : {}),
    productCode: clean.productCode,
    currency: clean.currency,
    requestedAmount: clean.requestedAmount,
    requestedTermMonths: clean.requestedTermMonths,
    paymentFrequency: clean.paymentFrequency,
    amortizationMethod: clean.amortizationMethod || 'SALDO_INSOLUTO',
    loanPurpose: clean.loanPurpose,
    ...(clean.loanPurposeDescription ? { loanPurposeDescription: clean.loanPurposeDescription } : {}),
    ...(clean.proposedCollateral ? { proposedCollateral: clean.proposedCollateral } : {}),
    monthlyIncome: clean.monthlyIncome,
    monthlyExpenses: clean.monthlyExpenses,
    ...(clean.employerOrActivity ? { employerOrActivity: clean.employerOrActivity } : {}),
    ...(clean.customerDetails ? { customerDetails: clean.customerDetails } : {}),
    ...(clean.businessDetails ? { businessDetails: clean.businessDetails } : {}),
    ...(clean.financialData ? { financialData: clean.financialData } : {}),
    ...(clean.businessFinancialData ? { businessFinancialData: clean.businessFinancialData } : {}),
    ...(clean.references && clean.references.length > 0 ? { references: clean.references } : {}),
    ...(clean.declaredDocumentsSummary
      ? { declaredDocumentsSummary: clean.declaredDocumentsSummary }
      : {}),
    ...(clean.attachedDocuments && clean.attachedDocuments.length > 0
      ? { attachedDocuments: clean.attachedDocuments }
      : {}),
    ...(clean.biometricSummary ? { biometricSummary: clean.biometricSummary } : {}),
    indicativeInstallment: indicative.installmentAmount,
    indicativeRateMonthly: indicative.monthlyRateUsed,
    consentVersion: clean.consentVersion || 'v1.0-Ley172-13',
    consentAccepted: true,
    consentAcceptedAt: nowIso,
    status: 'RECIBIDA_PUBLICA',
  };

  try {
    await setDoc(
      doc(db, 'public_credit_applications', id),
      stripUndefined({
        ...record,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `public_credit_applications/${id}`);
  }

  return record;
}

/**
 * Converts an incoming public web credit application into a formal AxyCore customer (+ business if applicable)
 * + application + attached documents, and executes the full Motor de Decisiones V2 + Motor de Cálculo Financiero.
 */
export async function convertPublicCreditApplicationToPipeline(params: {
  publicApp: PublicCreditApplicationRecord;
  policy: CreditPolicyRecord;
  staffUser: UserProfile;
}): Promise<{
  application: ApplicationRecord;
  customer: CustomerRecord;
  scoring?: ScoringExecutionRecord;
  financialAnalysis?: FinancialAnalysisRecord;
}> {
  const { publicApp, policy, staffUser } = params;
  const actorUid = auth.currentUser?.uid || staffUser.uid;
  const effectiveStaffUser: UserProfile = { ...staffUser, uid: actorUid };
  const orgId = publicApp.organizationId;
  const details = publicApp.customerDetails;

  // Use exact firstName/lastName when captured, or split full name cleanly for legacy entries
  const nameParts = publicApp.applicantFullName.trim().split(/\s+/).filter(Boolean);
  const firstName = (
    details?.firstName ||
    nameParts.slice(0, Math.max(1, Math.ceil(nameParts.length / 2))).join(' ') ||
    'Solicitante'
  ).slice(0, 120);
  const lastName = (
    details?.lastName ||
    nameParts.slice(Math.max(1, Math.ceil(nameParts.length / 2))).join(' ') ||
    firstName
  ).slice(0, 120);

  // 1. Reuse existing borrower in this institution or register a new unique customer with all captured fields
  const docKey = buildCustomerDocumentKey(orgId, publicApp.documentNumber, publicApp.documentType);
  const cleanDigits = normalizeDocumentDigits(publicApp.documentNumber);
  const deterministicCustId = buildCustomerDocId(orgId, publicApp.documentType, cleanDigits);
  let customer: CustomerRecord | null = null;

  const existingSnap = await getDocs(
    query(
      collection(db, 'customers'),
      where('organizationId', '==', orgId),
      where('documentKey', '==', docKey)
    )
  ).catch(() => null);

  if (existingSnap && existingSnap.docs.length > 0) {
    customer = {
      ...(existingSnap.docs[0].data() as CustomerRecord),
      id: existingSnap.docs[0].id,
    };
  } else {
    const directCustomerSnap = await getDoc(doc(db, 'customers', deterministicCustId)).catch(
      () => null
    );
    if (directCustomerSnap?.exists()) {
      const existingDirect = {
        ...(directCustomerSnap.data() as CustomerRecord),
        id: directCustomerSnap.id,
      };
      if (existingDirect.organizationId === orgId) {
        customer = existingDirect;
      }
    }
  }

  if (!customer) {
    customer = await saveCustomerUnique({
      organizationId: orgId,
      documentType: publicApp.documentType,
      documentNumber: publicApp.documentNumber.trim() || cleanDigits,
      firstName,
      lastName,
      ...(details?.birthDate ? { birthDate: details.birthDate } : {}),
      ...(details?.nationality ? { nationality: details.nationality } : {}),
      ...(details?.maritalStatus ? { maritalStatus: details.maritalStatus } : {}),
      phone: publicApp.phone.trim(),
      ...(details?.altPhone ? { altPhone: details.altPhone } : {}),
      ...(publicApp.email ? { email: publicApp.email.trim() } : {}),
      ...(publicApp.address ? { address: publicApp.address.trim() } : {}),
      ...(details?.municipality ? { municipality: details.municipality } : {}),
      ...(publicApp.province ? { province: publicApp.province.trim() } : {}),
      ...(typeof details?.residenceMonths === 'number'
        ? { residenceMonths: details.residenceMonths }
        : {}),
      ...(details?.housingType ? { housingType: details.housingType } : {}),
      ...(typeof details?.housingPayment === 'number'
        ? { housingPayment: details.housingPayment }
        : {}),
      ...(details?.socialMediaDeclared
        ? { socialMediaDeclared: details.socialMediaDeclared }
        : {}),
      ...(details?.socialMediaHandle ? { socialMediaHandle: details.socialMediaHandle } : {}),
      ...(details?.altContactName ? { altContactName: details.altContactName } : {}),
      ...(details?.altContactPhone ? { altContactPhone: details.altContactPhone } : {}),
      createdBy: actorUid,
    });
  }

  // 2. If BUSINESS applicant with corporate details, create/reuse BusinessRecord
  const isBusinessProduct =
    publicApp.applicantType === 'BUSINESS' ||
    publicApp.productCode === 'EMPRESARIAL_DOP' ||
    publicApp.productCode === 'EMPRESARIAL_USD';

  let businessId: string | null = null;
  if (isBusinessProduct && publicApp.businessDetails?.rnc && publicApp.businessDetails?.legalName) {
    try {
      const biz = await saveBusinessUnique({
        organizationId: orgId,
        rnc: publicApp.businessDetails.rnc.trim(),
        legalName: publicApp.businessDetails.legalName.trim(),
        tradeName: (publicApp.businessDetails.tradeName || '').trim(),
        companyType: (publicApp.businessDetails.companyType || 'SRL').trim(),
        economicActivity: (publicApp.businessDetails.economicActivity || '').trim(),
        operationsStartDate: (publicApp.businessDetails.operationsStartDate || '').trim(),
        authorizedRepName: (
          publicApp.businessDetails.authorizedRepName || publicApp.applicantFullName
        ).trim(),
        authorizedRepDoc: (
          publicApp.businessDetails.authorizedRepDoc || publicApp.documentNumber
        ).trim(),
        corporateDocsSummary: (publicApp.businessDetails.corporateDocsSummary || '').trim(),
        createdBy: actorUid,
      });
      businessId = biz.id;
    } catch (bizErr) {
      console.warn('No se pudo registrar empresa desde solicitud pública:', bizErr);
    }
  }

  // 3. Build formal ApplicationRecord with full 5-step data & execute Motor V2 + Motor de Cálculo Financiero
  const appId = generateId('app');
  const seq = String(Date.now()).slice(-6);
  const year = new Date().getFullYear();

  const financialData = publicApp.financialData ?? {
    activityType: isBusinessProduct ? 'Negocio propio' : 'Empleado privado',
    employerOrBusinessName: publicApp.employerOrActivity || 'Declarado en solicitud pública web',
    primaryNetIncome: publicApp.monthlyIncome,
    additionalNetIncome: 0,
    declaredTotalMonthlyIncome: publicApp.monthlyIncome,
    essentialExpenses: publicApp.monthlyExpenses,
    currentDebtPayments: 0,
    incomeCurrency: publicApp.currency,
    debtDeclarationStatus: 'NO_DEBTS_EXPLICIT' as const,
  };

  const appRecord: ApplicationRecord = {
    id: appId,
    organizationId: orgId,
    applicationNumber: `SOL-${year}-${seq}`,
    fileNumber: `EXP-${year}-${seq}`,
    channel: 'EXTERNAL',
    applicantType: isBusinessProduct ? 'BUSINESS' : 'INDIVIDUAL',
    customerId: customer.id,
    businessId,
    applicantDisplayName: publicApp.applicantFullName.trim().slice(0, 200),
    productCode: publicApp.productCode,
    currency: publicApp.currency,
    requestedAmount: publicApp.requestedAmount,
    requestedTermMonths: publicApp.requestedTermMonths,
    paymentFrequency: publicApp.paymentFrequency,
    amortizationMethod: publicApp.amortizationMethod || 'SALDO_INSOLUTO',
    loanPurpose: publicApp.loanPurpose,
    ...(publicApp.loanPurposeDescription
      ? { loanPurposeDescription: publicApp.loanPurposeDescription }
      : {}),
    ...(publicApp.proposedCollateral ? { proposedCollateral: publicApp.proposedCollateral } : {}),
    financialData,
    businessFinancialData: isBusinessProduct ? publicApp.businessFinancialData ?? null : null,
    references: publicApp.references ?? [],
    declaredDocumentsSummary: publicApp.declaredDocumentsSummary ?? {
      hasIdentityDoc: false,
      hasIncomeEvidence: false,
    },
    status: 'RECIBIDA',
    consentVersion: publicApp.consentVersion || 'v1.0-Ley172-13',
    consentAcceptedAt: publicApp.consentAcceptedAt,
    createdBy: actorUid,
    createdByName: (effectiveStaffUser.displayName || effectiveStaffUser.email || 'Oficial').slice(0, 160),
  };

  const pipelineRes = await submitOrSaveApplication({
    application: appRecord,
    customer,
    policy,
    mode: 'SUBMIT',
    user: effectiveStaffUser,
    consentText: `Solicitud recibida vía enlace externo público (${publicApp.portalCode} · Ref. ${publicApp.trackingNumber}) con consentimiento Ley 172-13 (${appRecord.consentVersion}) aceptado el ${publicApp.consentAcceptedAt}.`,
  });

  // 4. Transfer any attached documents into application_documents
  if (Array.isArray(publicApp.attachedDocuments) && publicApp.attachedDocuments.length > 0) {
    for (const att of publicApp.attachedDocuments) {
      try {
        await uploadDocumentRecord(
          {
            id: generateId('doc'),
            organizationId: orgId,
            applicationId: appId,
            category: att.category,
            fileName: att.fileName,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
            fileDataUrl: att.fileDataUrl,
            notes: att.notes,
            reviewStatus: 'RECIBIDO',
            uploadedBy: actorUid,
            uploadedByName: (effectiveStaffUser.displayName || effectiveStaffUser.email || 'Oficial').slice(0, 160),
          },
          effectiveStaffUser
        );
      } catch (docErr) {
        console.warn('No se pudo transferir adjunto desde solicitud pública:', att.fileName, docErr);
      }
    }
  }

  // 5. Mark the public application as ingested
  const reviewNotes = `Ingresada como ${pipelineRes.application.applicationNumber} (${pipelineRes.application.status}).`.slice(
    0,
    600
  );
  try {
    await updateDoc(doc(db, 'public_credit_applications', publicApp.id), {
      status: 'INGRESADA_MOTOR',
      convertedApplicationId: pipelineRes.application.id,
      convertedBy: actorUid,
      convertedByName: (effectiveStaffUser.displayName || effectiveStaffUser.email || 'Oficial').slice(0, 160),
      convertedAt: new Date().toISOString().slice(0, 40),
      reviewNotes,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `public_credit_applications/${publicApp.id}`);
  }

  return {
    application: pipelineRes.application,
    customer,
    scoring: pipelineRes.scoring,
    financialAnalysis: pipelineRes.financialAnalysis,
  };
}

/**
 * Discards / archives an incoming public credit application (staff-only, tenant-isolated).
 */
export async function discardPublicCreditApplication(params: {
  publicAppId: string;
  staffUser: UserProfile;
  reviewNotes: string;
}): Promise<void> {
  try {
    await updateDoc(doc(db, 'public_credit_applications', params.publicAppId), {
      status: 'DESCARTADA',
      convertedBy: auth.currentUser?.uid || params.staffUser.uid,
      convertedByName: (params.staffUser.displayName || params.staffUser.email || 'Oficial').slice(0, 160),
      convertedAt: new Date().toISOString().slice(0, 40),
      reviewNotes: params.reviewNotes.trim().slice(0, 600) || 'Descartada por revisión operativa.',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `public_credit_applications/${params.publicAppId}`);
  }
}

