import { describe, expect, it } from 'vitest';
import {
  PRIMARY_SUPERADMIN_EMAIL,
  buildDeterministicInvitationId,
  buildInvitationActivationUrl,
  buildInvitationEmailContent,
  deduplicateCorporateUsers,
  isPrimarySuperAdminEmail,
  normalizeEmailAddress,
  parseInvitationParamsFromSearch,
  resolveInvitedUserBootstrap,
} from '../engine/invitationFlow';
import {
  DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE,
  SU_GLORIA_ORG_ID,
} from '../engine/multiTenantEngine';
import type { UserInvitationRecord, UserProfile } from '../types/axycore';

describe('AxyCore Invitation Flow & SuperAdmin Universal Access', () => {
  it('identifies primary SuperAdmin email case-insensitively', () => {
    expect(PRIMARY_SUPERADMIN_EMAIL).toBe('andrygallardo7@gmail.com');
    expect(isPrimarySuperAdminEmail('ANDRYGALLARDO7@GMAIL.COM ')).toBe(true);
    expect(isPrimarySuperAdminEmail('andrygallardo7@gmail.com')).toBe(true);
    expect(isPrimarySuperAdminEmail('otro.usuario@sugloria.com')).toBe(false);
    expect(isPrimarySuperAdminEmail(null)).toBe(false);
  });

  it('builds valid deterministic Firestore IDs for user_invitations', () => {
    const id1 = buildDeterministicInvitationId('Nuevo.Admin@SuGloria.com');
    const id2 = buildDeterministicInvitationId('  nuevo.admin@sugloria.com ');
    expect(id1).toBe(id2);
    expect(id1.startsWith('inv_')).toBe(true);
    expect(/^[a-zA-Z0-9_-]+$/.test(id1)).toBe(true);
    expect(id1.length).toBeLessThanOrEqual(128);
  });

  it('builds and parses invitation activation URLs round-trip', () => {
    const inviteId = buildDeterministicInvitationId('gerente@sugloria.com');
    const url = buildInvitationActivationUrl({
      origin: 'https://axycore.app/',
      inviteId,
      orgCode: 'sgma-001',
      email: 'Gerente@SuGloria.com',
    });

    expect(url).toContain('https://axycore.app/?');
    const parsedUrl = new URL(url);
    const parsed = parseInvitationParamsFromSearch(parsedUrl.search);

    expect(parsed.isInvitationLink).toBe(true);
    expect(parsed.inviteId).toBe(inviteId);
    expect(parsed.orgCode).toBe('SGMA-001');
    expect(parsed.email).toBe('gerente@sugloria.com');

    // Legacy tenantInvite parameter still works
    const legacy = parseInvitationParamsFromSearch('?tenantInvite=inv_legacy_1&code=SGMA-001');
    expect(legacy.isInvitationLink).toBe(true);
    expect(legacy.inviteId).toBe('inv_legacy_1');
    expect(legacy.orgCode).toBe('SGMA-001');
  });

  it('always resolves andrygallardo7@gmail.com as ADMIN regardless of invitations or stale profile', () => {
    const staleProfile: UserProfile = {
      uid: 'uid_super',
      email: 'andrygallardo7@gmail.com',
      displayName: 'Andry Gallardo',
      role: 'MANAGEMENT',
      status: 'ACTIVE',
      organizationId: SU_GLORIA_ORG_ID,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const resolution = resolveInvitedUserBootstrap({
      uid: 'uid_super',
      email: 'ANDRYGALLARDO7@gmail.com',
      authDisplayName: 'Andry Gallardo',
      existingProfile: staleProfile,
      pendingInvitation: null,
    });

    expect(resolution.role).toBe('ADMIN');
    expect(resolution.shouldClaimInvitation).toBe(false);
    expect(resolution.organizationId).toBe(SU_GLORIA_ORG_ID);
  });

  it('claims a pending invitation for a newly invited Admin in Su Gloria Mano Amiga', () => {
    const pendingInvitation: UserInvitationRecord = {
      id: buildDeterministicInvitationId('nuevo.admin@sugloria.com'),
      email: 'nuevo.admin@sugloria.com',
      displayName: 'Carlos Méndez',
      role: 'ADMIN',
      organizationId: SU_GLORIA_ORG_ID,
      organizationName: 'SU GLORIA MANO AMIGA',
      accessCode: 'SGMA-001',
      status: 'INVITACION_ENVIADA',
      invitationLink: 'https://axycore.app/?invite=inv_nuevo_admin_sugloria_com&orgCode=SGMA-001',
      invitedBy: 'andrygallardo7@gmail.com',
      invitedAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    };

    const resolution = resolveInvitedUserBootstrap({
      uid: 'firebase_uid_carlos',
      email: 'Nuevo.Admin@SuGloria.com',
      authDisplayName: null,
      existingProfile: null,
      pendingInvitation,
    });

    expect(resolution.shouldClaimInvitation).toBe(true);
    expect(resolution.role).toBe('ADMIN');
    expect(resolution.organizationId).toBe(SU_GLORIA_ORG_ID);
    expect(resolution.displayName).toBe('Carlos Méndez');
    expect(resolution.invitationId).toBe(pendingInvitation.id);
    expect(resolution.membershipPayload).toBeDefined();
    expect(resolution.membershipPayload?.id).toBe(`${SU_GLORIA_ORG_ID}_firebase_uid_carlos`);
    expect(resolution.membershipPayload?.status).toBe('ACTIVE');
    expect(resolution.membershipPayload?.isPrimaryAdmin).toBe(true);
    expect(resolution.membershipPayload?.granularPermissions).toEqual(
      DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE.ADMIN
    );
  });

  it('upgrades a previously created EXTERNAL_CLIENT profile when a corporate invitation exists', () => {
    const existingClient: UserProfile = {
      uid: 'firebase_uid_analista',
      email: 'analista@sugloria.com',
      displayName: 'María Analista',
      role: 'EXTERNAL_CLIENT',
      status: 'ACTIVE',
      organizationId: SU_GLORIA_ORG_ID,
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    };

    const pendingInvitation: UserInvitationRecord = {
      id: buildDeterministicInvitationId('analista@sugloria.com'),
      email: 'analista@sugloria.com',
      displayName: 'María Analista',
      role: 'CREDIT_ANALYST',
      organizationId: SU_GLORIA_ORG_ID,
      organizationName: 'SU GLORIA MANO AMIGA',
      accessCode: 'SGMA-001',
      status: 'INVITACION_ENVIADA',
      invitationLink: 'https://axycore.app/?invite=inv_analista_sugloria_com&orgCode=SGMA-001',
      invitedBy: 'andrygallardo7@gmail.com',
      invitedAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    };

    const resolution = resolveInvitedUserBootstrap({
      uid: 'firebase_uid_analista',
      email: 'analista@sugloria.com',
      authDisplayName: 'María Analista',
      existingProfile: existingClient,
      pendingInvitation,
    });

    expect(resolution.shouldClaimInvitation).toBe(true);
    expect(resolution.role).toBe('CREDIT_ANALYST');
    expect(resolution.membershipPayload?.status).toBe('ACTIVE');
  });

  it('does not re-claim REVOKED or already ACCEPTED invitations and defaults uninvited users to EXTERNAL_CLIENT', () => {
    const revokedInv: UserInvitationRecord = {
      id: buildDeterministicInvitationId('externo@gmail.com'),
      email: 'externo@gmail.com',
      displayName: 'Usuario Externo',
      role: 'ADMIN',
      organizationId: SU_GLORIA_ORG_ID,
      organizationName: 'SU GLORIA MANO AMIGA',
      accessCode: 'SGMA-001',
      status: 'REVOKED',
      invitationLink: 'https://axycore.app/?invite=inv_externo_gmail_com',
      invitedBy: 'andrygallardo7@gmail.com',
      invitedAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    };

    const resolution = resolveInvitedUserBootstrap({
      uid: 'uid_externo',
      email: 'externo@gmail.com',
      authDisplayName: 'Usuario Externo',
      existingProfile: null,
      pendingInvitation: revokedInv,
    });

    expect(resolution.shouldClaimInvitation).toBe(false);
    expect(resolution.role).toBe('EXTERNAL_CLIENT');
    expect(resolution.membershipPayload).toBeUndefined();
  });

  it('generates branded invitation email HTML and plain text with org code and activation URL', () => {
    const link = 'https://axycore.app/?invite=inv_test&orgCode=SGMA-001&email=test%40sugloria.com';
    const content = buildInvitationEmailContent({
      displayName: 'Laura Pérez',
      email: 'test@sugloria.com',
      roleLabel: 'Administrador',
      organizationName: 'SU GLORIA MANO AMIGA',
      accessCode: 'SGMA-001',
      invitationLink: link,
      resetSent: true,
    });

    expect(content.subject).toContain('SU GLORIA MANO AMIGA');
    expect(content.subject).toContain('Administrador');
    expect(content.text).toContain('SGMA-001');
    expect(content.text).toContain(link);
    expect(content.html).toContain('SGMA-001');
    expect(content.html).toContain('Activar cuenta e ingresar automáticamente');
  });

  it('deduplicates pre-provisioned usr_ placeholder when real Firebase Auth UID exists for the same email', () => {
    const placeholder: UserProfile = {
      uid: 'usr_laura_sugloria_com',
      email: 'laura@sugloria.com',
      displayName: 'Laura Pérez',
      role: 'ADMIN',
      status: 'INVITED',
      invitationStatus: 'INVITACION_ENVIADA',
      organizationId: SU_GLORIA_ORG_ID,
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    };

    const realUser: UserProfile = {
      uid: 'google_uid_laura_991',
      email: 'Laura@SuGloria.com',
      displayName: 'Laura Pérez',
      role: 'ADMIN',
      status: 'ACTIVE',
      invitationStatus: 'CONFIRMADA',
      organizationId: SU_GLORIA_ORG_ID,
      createdAt: '2026-03-01T10:05:00.000Z',
      updatedAt: '2026-03-01T10:05:00.000Z',
    };

    const deduped = deduplicateCorporateUsers([placeholder, realUser]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].uid).toBe('google_uid_laura_991');
    expect(deduped[0].status).toBe('ACTIVE');
    expect(normalizeEmailAddress(deduped[0].email)).toBe('laura@sugloria.com');
  });
});
