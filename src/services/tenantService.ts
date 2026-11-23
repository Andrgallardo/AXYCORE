import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  serverTimestamp,
  type DocumentData,
  type Query,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import type {
  OrganizationMembershipRecord,
  OrganizationRecord,
  UserProfile,
} from '../types/axycore';

export const PLATFORM_OWNER_EMAIL = 'andrygallardo7@gmail.com';
export const SU_GLORIA_ORG_ID = 'org_axycore_main';
export const SU_GLORIA_TENANT_ID = 'su-gloria-mano-amiga';

export function isSuperAdminUser(
  userProfile?: UserProfile | null,
  emailVerified = true
): boolean {
  if (!userProfile || userProfile.status !== 'ACTIVE') return false;
  if (
    userProfile.email?.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase() &&
    emailVerified
  ) {
    return true;
  }
  return Boolean(userProfile.isSuperAdmin && userProfile.role === 'ADMIN' && emailVerified);
}

export const ORGANIZATIONS_COLLECTION = 'organizations';
export const ORGANIZATION_MEMBERSHIPS_COLLECTION = 'organization_memberships';

/**
 * Catálogo de colecciones Firestore sujetas a aislamiento estricto por tenant_id u organizationId.
 * Cada consulta a estas colecciones filtrará automáticamente por la organización del usuario actual.
 */
export const TENANT_SCOPED_COLLECTIONS = new Set<string>([
  'customers',
  'businesses',
  'applications',
  'application_documents',
  'application_consents',
  'credit_policies',
  'scoring_executions',
  'credit_evaluations',
  'committee_decisions',
  'formalizations',
  'disbursements',
  'loans',
  'loan_installments',
  'audit_logs',
  'email_notifications',
  'fcm_tokens',
  'push_subscriptions',
  'collection_accounts',
  'collection_assignments',
  'collection_actions',
  'collection_tasks',
  'payment_promises',
  'payment_agreements',
  'payments',
  'payment_allocations',
  'payment_reversals',
  'collection_receipts',
  'payment_intents',
  'bank_transactions',
  'reconciliation_matches',
  'reconciliation_exceptions',
  'collector_targets',
  'collection_campaigns',
  'message_templates',
  'message_events',
  'risk_alerts',
  'customer_disputes',
  'collection_policy_versions',
  'collection_daily_snapshots',
  'notifications',
  'organization_memberships',
  'licenses',
  'subscriptions',
  'altera_scenarios',
  'altera_recommendations',
  'altera_outcomes',
  'altera_analyses',
  'altera_configs',
  'impulsa_opportunities',
  'impulsa_configs',
]);

export interface TenantContext {
  activeTenantId: string;
  activeOrganizationId: string;
  currentUser: UserProfile | null;
  currentOrganization: OrganizationRecord | null;
  memberships: OrganizationMembershipRecord[];
}

/**
 * Servicio Centralizado de Gestión Multi-Tenant y Aislamiento por tenant_id.
 *
 * Garantiza que toda consulta, lectura, escritura o suscripción a Firestore
 * incorpore automáticamente el filtro de la organización del usuario actual,
 * previniendo filtraciones de datos entre empresas clientes de AxyCore.
 */
export class TenantService {
  private activeTenantId: string = SU_GLORIA_TENANT_ID;
  private activeOrganizationId: string = SU_GLORIA_ORG_ID;
  private currentUser: UserProfile | null = null;
  private currentOrganization: OrganizationRecord | null = null;
  private memberships: OrganizationMembershipRecord[] = [];

  /**
   * Actualiza el contexto global del tenant en el servicio.
   */
  public setContext(params: {
    user?: UserProfile | null;
    organization?: OrganizationRecord | null;
    tenantId?: string | null;
    organizationId?: string | null;
    memberships?: OrganizationMembershipRecord[];
  }): void {
    if (params.user !== undefined) {
      this.currentUser = params.user;
    }
    if (params.organization !== undefined) {
      this.currentOrganization = params.organization;
    }
    if (params.memberships !== undefined) {
      this.memberships = params.memberships;
    }

    const orgId =
      params.organizationId ||
      params.organization?.organizationId ||
      params.organization?.id ||
      params.user?.organizationId ||
      this.activeOrganizationId;

    const tId =
      params.tenantId ||
      params.organization?.tenant_id ||
      params.organization?.tenantId ||
      (orgId === SU_GLORIA_ORG_ID ? SU_GLORIA_TENANT_ID : orgId);

    this.activeOrganizationId = orgId || SU_GLORIA_ORG_ID;
    this.activeTenantId = tId || this.activeOrganizationId;
  }

  /**
   * Establece el usuario autenticado actual.
   */
  public setCurrentUser(user: UserProfile | null): void {
    this.currentUser = user;
    if (user?.organizationId) {
      this.activeOrganizationId = user.organizationId;
      if (user.organizationId === SU_GLORIA_ORG_ID) {
        this.activeTenantId = SU_GLORIA_TENANT_ID;
      } else {
        this.activeTenantId = user.organizationId;
      }
    }
  }

  /**
   * Establece el tenant activo (por ID de organización o tenant_id).
   */
  public setCurrentTenant(tenantIdOrOrgId: string | null): void {
    if (!tenantIdOrOrgId) {
      this.activeOrganizationId = SU_GLORIA_ORG_ID;
      this.activeTenantId = SU_GLORIA_TENANT_ID;
      return;
    }
    this.activeOrganizationId = tenantIdOrOrgId;
    this.activeTenantId =
      tenantIdOrOrgId === SU_GLORIA_ORG_ID ? SU_GLORIA_TENANT_ID : tenantIdOrOrgId;
  }

  /**
   * Obtiene el contexto activo actual.
   */
  public getContext(): TenantContext {
    return {
      activeTenantId: this.activeTenantId,
      activeOrganizationId: this.activeOrganizationId,
      currentUser: this.currentUser,
      currentOrganization: this.currentOrganization,
      memberships: this.memberships,
    };
  }

  /**
   * Retorna el tenant_id canónico activo.
   */
  public getActiveTenantId(): string {
    return this.activeTenantId || SU_GLORIA_TENANT_ID;
  }

  /**
   * Retorna el organizationId activo.
   */
  public getActiveOrganizationId(): string {
    return this.activeOrganizationId || SU_GLORIA_ORG_ID;
  }

  /**
   * Retorna el usuario autenticado actual en memoria.
   */
  public getCurrentUser(): UserProfile | null {
    return this.currentUser;
  }

  /**
   * Retorna la organización activa actual en memoria.
   */
  public getCurrentOrganization(): OrganizationRecord | null {
    return this.currentOrganization;
  }

  /**
   * Determina si el usuario actual es Superadministrador AxyCore.
   */
  public isSuperAdmin(): boolean {
    return isSuperAdminUser(this.currentUser, true);
  }

  /**
   * Resuelve el tenant_id o organizationId a partir de un valor u objeto.
   */
  public resolveTenantId(
    target?: string | { organizationId?: string; tenantId?: string; tenant_id?: string } | null
  ): string {
    if (!target) return this.getActiveTenantId();
    if (typeof target === 'string') return target.trim();
    return target.tenant_id || target.tenantId || target.organizationId || this.getActiveTenantId();
  }

  /**
   * Comprueba si el usuario tiene acceso legítimo a un tenant determinado.
   */
  public canUserAccessTenant(targetTenantOrOrgId: string): boolean {
    if (!targetTenantOrOrgId) return false;
    if (this.isSuperAdmin()) return true;
    if (!this.currentUser || this.currentUser.status !== 'ACTIVE') return false;

    const normalizedTarget = targetTenantOrOrgId.trim();
    if (
      this.currentUser.organizationId === normalizedTarget ||
      this.activeOrganizationId === normalizedTarget ||
      this.activeTenantId === normalizedTarget
    ) {
      return true;
    }

    return this.memberships.some(
      (m) =>
        (m.userId === this.currentUser?.uid ||
          m.userEmail.toLowerCase() === this.currentUser?.email.toLowerCase()) &&
        (m.organizationId === normalizedTarget ||
          m.tenantId === normalizedTarget ||
          m.tenant_id === normalizedTarget) &&
        m.status === 'ACTIVE'
    );
  }

  /**
   * Asegura que una operación respeta el aislamiento por tenant, lanzando error si hay intento de cruce indebido.
   */
  public assertTenantAccess(recordTenantOrOrgId?: string, actionName = 'operación'): void {
    if (!recordTenantOrOrgId) return;
    if (this.isSuperAdmin()) return;

    if (!this.canUserAccessTenant(recordTenantOrOrgId)) {
      throw new Error(
        `Violación de seguridad Multi-Tenant: Acceso denegado a la ${actionName}. El registro pertenece al tenant «${recordTenantOrOrgId}» y el usuario actual pertenece a «${this.getActiveOrganizationId()}».`
      );
    }
  }

  /**
   * Filtra un arreglo de registros en memoria asegurando que solo contenga los del tenant actual.
   */
  public filterRecordsByTenant<
    T extends { organizationId?: string; tenantId?: string; tenant_id?: string }
  >(records: T[], overrideTenantId?: string): T[] {
    const targetOrg = overrideTenantId || this.getActiveOrganizationId();
    const targetTenant = overrideTenantId || this.getActiveTenantId();
    if (!targetOrg) return [];
    return records.filter(
      (r) =>
        r.organizationId === targetOrg ||
        r.tenantId === targetTenant ||
        r.tenant_id === targetTenant ||
        (targetOrg === SU_GLORIA_ORG_ID && (!r.organizationId || r.organizationId === 'org_default'))
    );
  }

  // =========================================================================
  // Métodos de Consulta Firestore con Aislamiento Automático por tenant_id
  // =========================================================================

  /**
   * Construye una consulta Firestore garantizando que se aplique AUTOMÁTICAMENTE
   * el filtro por la organización del usuario actual (`organizationId == activeOrgId`).
   */
  public buildTenantQuery<T = DocumentData>(
    collectionName: string,
    ...additionalConstraints: QueryConstraint[]
  ): Query<T> {
    const colRef = collection(db, collectionName);
    const activeOrgId = this.getActiveOrganizationId() || SU_GLORIA_ORG_ID;

    // Si la colección es 'organizations' y el superadmin no ha fijado un tenant específico, permite listar todas
    if (collectionName === ORGANIZATIONS_COLLECTION && this.isSuperAdmin()) {
      return (additionalConstraints.length > 0
        ? query(colRef, ...additionalConstraints)
        : colRef) as Query<T>;
    }

    // Para cualquier colección de negocio (clientes, préstamos, cobranzas, etc.),
    // inyecta incondicionalmente el filtro de organización del usuario
    const tenantFilter = where('organizationId', '==', activeOrgId);
    return query(colRef, tenantFilter, ...additionalConstraints) as Query<T>;
  }

  /**
   * Consulta documentos de una colección filtrando automáticamente por la organización del usuario actual.
   */
  public async queryCollection<T = DocumentData>(
    collectionName: string,
    ...constraints: QueryConstraint[]
  ): Promise<T[]> {
    try {
      const q = this.buildTenantQuery<T>(collectionName, ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, collectionName);
      return [];
    }
  }

  /**
   * Suscribe en tiempo real a una colección filtrando automáticamente por la organización del usuario actual.
   */
  public subscribeCollection<T = DocumentData>(
    collectionName: string,
    onData: (items: T[]) => void,
    onError?: (err: unknown) => void,
    ...constraints: QueryConstraint[]
  ): Unsubscribe {
    const q = this.buildTenantQuery<T>(collectionName, ...constraints);
    return onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
        onData(items);
      },
      (err) => {
        if (onError) {
          onError(err);
        } else {
          handleFirestoreError(err, OperationType.LIST, collectionName);
        }
      }
    );
  }

  /**
   * Obtiene un documento de Firestore y verifica que pertenezca a la organización del usuario.
   */
  public async getScopedDoc<T = DocumentData>(
    collectionName: string,
    docId: string
  ): Promise<T | null> {
    try {
      const docRef = doc(db, collectionName, docId);
      const snap = await getDoc(docRef);
      if (!snap.exists()) return null;

      const data = snap.data() as Record<string, unknown>;
      const recordOrgId = (data.organizationId as string) || (data.tenant_id as string);

      // Verificar aislamiento estricto si es colección de tenant
      if (recordOrgId && !this.isSuperAdmin()) {
        this.assertTenantAccess(recordOrgId, `lectura de ${collectionName}/${docId}`);
      }

      return { ...(data as T), id: snap.id };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `${collectionName}/${docId}`);
      return null;
    }
  }

  /**
   * Crea un nuevo documento en Firestore inyectando automáticamente tenant_id, tenantId y organizationId.
   */
  public async createScopedDoc<T extends Record<string, unknown>>(
    collectionName: string,
    data: T,
    customDocId?: string
  ): Promise<string> {
    const activeOrgId = this.getActiveOrganizationId();
    const activeTenantId = this.getActiveTenantId();

    const targetDocId =
      customDocId ||
      (typeof data.id === 'string' && data.id.trim()
        ? data.id.trim()
        : doc(collection(db, collectionName)).id);

    const enrichedPayload = {
      ...data,
      id: targetDocId,
      organizationId: (data.organizationId as string) || activeOrgId,
      tenantId: (data.tenantId as string) || activeTenantId,
      tenant_id: (data.tenant_id as string) || activeTenantId,
      createdAt: data.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const docRef = doc(db, collectionName, targetDocId);
    await setDoc(docRef, enrichedPayload).catch((err) =>
      handleFirestoreError(err, OperationType.CREATE, `${collectionName}/${targetDocId}`)
    );

    return targetDocId;
  }

  /**
   * Actualiza un documento verificando previamente que pertenece a la organización del usuario actual.
   */
  public async updateScopedDoc<T extends Record<string, unknown>>(
    collectionName: string,
    docId: string,
    data: Partial<T>
  ): Promise<void> {
    const existing = await this.getScopedDoc<Record<string, unknown>>(collectionName, docId);
    if (!existing) {
      throw new Error(`El documento ${collectionName}/${docId} no existe.`);
    }

    const payload = {
      ...data,
      organizationId: existing.organizationId || this.getActiveOrganizationId(),
      tenantId: existing.tenantId || this.getActiveTenantId(),
      tenant_id: existing.tenant_id || this.getActiveTenantId(),
      updatedAt: serverTimestamp(),
    };

    const docRef = doc(db, collectionName, docId);
    await updateDoc(docRef, payload).catch((err) =>
      handleFirestoreError(err, OperationType.UPDATE, `${collectionName}/${docId}`)
    );
  }

  /**
   * Elimina un documento verificando previamente que pertenece a la organización del usuario actual.
   */
  public async deleteScopedDoc(collectionName: string, docId: string): Promise<void> {
    await this.getScopedDoc(collectionName, docId);
    const docRef = doc(db, collectionName, docId);
    await deleteDoc(docRef).catch((err) =>
      handleFirestoreError(err, OperationType.DELETE, `${collectionName}/${docId}`)
    );
  }
}

/**
 * Instancia Singleton de TenantService para uso transversal en AxyCore.
 */
export const tenantService = new TenantService();
