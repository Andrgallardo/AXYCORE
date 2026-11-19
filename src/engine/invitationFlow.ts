import { sanitizeIdSegment } from '../utils/formatters';
import {
  DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE,
  SU_GLORIA_MANO_AMIGA_ORG,
  SU_GLORIA_ORG_ID,
} from './multiTenantEngine';
import type {
  OrganizationMembershipRecord,
  UserInvitationRecord,
  UserProfile,
  UserRole,
} from '../types/axycore';

export const PRIMARY_SUPERADMIN_EMAIL = 'andrygallardo7@gmail.com';

export function normalizeEmailAddress(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

export function isPrimarySuperAdminEmail(email: string | null | undefined): boolean {
  return normalizeEmailAddress(email) === PRIMARY_SUPERADMIN_EMAIL;
}

/**
 * Deterministic Firestore document ID for `user_invitations/{id}` keyed by normalized email.
 * Guaranteed to satisfy Firestore `isValidId` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
 */
export function buildDeterministicInvitationId(email: string): string {
  const clean = normalizeEmailAddress(email);
  const safeSegment = sanitizeIdSegment(clean).slice(0, 110);
  return `inv_${safeSegment || 'user'}`;
}

export function buildInvitationActivationUrl(params: {
  origin: string;
  inviteId: string;
  orgCode: string;
  email: string;
}): string {
  const baseOrigin = (params.origin || 'http://localhost:3000').replace(/\/+$/, '');
  const cleanEmail = normalizeEmailAddress(params.email);
  const cleanCode = (params.orgCode || SU_GLORIA_MANO_AMIGA_ORG.accessCode || 'SGMA-001')
    .trim()
    .toUpperCase();
  const query = new URLSearchParams({
    invite: params.inviteId,
    orgCode: cleanCode,
    email: cleanEmail,
  });
  return `${baseOrigin}/?${query.toString()}`;
}

export interface ParsedInvitationLinkParams {
  inviteId: string | null;
  orgCode: string | null;
  email: string | null;
  isInvitationLink: boolean;
}

export function parseInvitationParamsFromSearch(search: string): ParsedInvitationLinkParams {
  const params = new URLSearchParams(search || '');
  const inviteId = params.get('invite')?.trim() || params.get('tenantInvite')?.trim() || null;
  const orgCode =
    params.get('orgCode')?.trim().toUpperCase() ||
    params.get('code')?.trim().toUpperCase() ||
    null;
  const rawEmail = params.get('email')?.trim() || null;
  const email = rawEmail ? normalizeEmailAddress(rawEmail) : null;

  return {
    inviteId,
    orgCode,
    email,
    isInvitationLink: Boolean(inviteId || orgCode),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInvitationEmailContent(params: {
  displayName: string;
  email: string;
  roleLabel: string;
  organizationName: string;
  accessCode: string;
  invitationLink: string;
  resetSent: boolean;
}): { subject: string; text: string; html: string } {
  const orgName = params.organizationName || SU_GLORIA_MANO_AMIGA_ORG.tradeName || 'SU GLORIA MANO AMIGA';
  const accessCode = (params.accessCode || SU_GLORIA_MANO_AMIGA_ORG.accessCode || 'SGMA-001').toUpperCase();
  const subject = `Invitación de Acceso a ${orgName} — Rol: ${params.roleLabel}`;

  const passwordNote = params.resetSent
    ? 'También te hemos enviado un correo de Firebase Authentication para que puedas crear tu contraseña personal si prefieres ingresar con correo y contraseña.'
    : 'Puedes activar tu cuenta inmediatamente con Google usando este correo o registrando tu contraseña personal desde el enlace de activación.';

  const text = [
    `Hola ${params.displayName},`,
    '',
    `Has sido invitado al portal corporativo de ${orgName} en AxyCore con el rol: ${params.roleLabel}.`,
    '',
    `Código Corporativo: ${accessCode}`,
    `Correo autorizado: ${normalizeEmailAddress(params.email)}`,
    `Enlace directo de activación y registro automático:`,
    params.invitationLink,
    '',
    passwordNote,
    '',
    'Al abrir el enlace e iniciar sesión (con Google o correo/contraseña), tu rol y acceso corporativo se activarán automáticamente.',
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#030816; color:#e2e8f0; padding:32px 16px;">
      <div style="max-width:560px; margin:0 auto; background:#071128; border:1px solid rgba(0,184,255,0.28); border-radius:16px; overflow:hidden;">
        <div style="padding:24px 28px; border-bottom:1px solid rgba(0,184,255,0.18); background:linear-gradient(135deg,#041B4E 0%,#0052CC 100%);">
          <div style="font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:#7dd3fc; font-weight:700;">AxyCore · Acceso Corporativo</div>
          <h1 style="margin:8px 0 0; font-size:20px; color:#ffffff;">Invitación a ${escapeHtml(orgName)}</h1>
        </div>
        <div style="padding:24px 28px; line-height:1.6; font-size:14px;">
          <p style="margin-top:0;">Hola <strong>${escapeHtml(params.displayName)}</strong>,</p>
          <p>Has sido invitado a unirte al espacio corporativo de <strong>${escapeHtml(orgName)}</strong> con el rol asignado de <strong style="color:#38bdf8;">${escapeHtml(params.roleLabel)}</strong>.</p>
          <div style="margin:20px 0; padding:14px 16px; border-radius:12px; background:#040C1E; border:1px solid rgba(0,184,255,0.22);">
            <div style="font-size:12px; color:#94a3b8;">Código Corporativo</div>
            <div style="font-family:monospace; font-size:16px; font-weight:700; color:#38bdf8; margin-top:2px;">${escapeHtml(accessCode)}</div>
            <div style="font-size:12px; color:#94a3b8; margin-top:8px;">Correo autorizado: <span style="color:#f8fafc;">${escapeHtml(normalizeEmailAddress(params.email))}</span></div>
          </div>
          <div style="text-align:center; margin:24px 0;">
            <a href="${escapeHtml(params.invitationLink)}" style="display:inline-block; padding:12px 24px; border-radius:10px; background:linear-gradient(90deg,#0066FF 0%,#00B8FF 100%); color:#ffffff; text-decoration:none; font-weight:700; font-size:14px;">Activar cuenta e ingresar automáticamente</a>
          </div>
          <p style="font-size:12px; color:#cbd5e1;">${escapeHtml(passwordNote)}</p>
          <p style="font-size:11px; color:#94a3b8; word-break:break-all;">Si el botón no funciona, copia y abre este enlace: ${escapeHtml(params.invitationLink)}</p>
        </div>
      </div>
    </div>
  `.trim();

  return { subject, text, html };
}

export interface InvitationClaimResolution {
  shouldClaimInvitation: boolean;
  role: UserRole;
  organizationId: string;
  displayName: string;
  invitationId?: string;
  invitedBy?: string;
  invitedAt?: string;
  membershipPayload?: Omit<OrganizationMembershipRecord, 'createdAt' | 'updatedAt'>;
}

export function resolveInvitedUserBootstrap(params: {
  uid: string;
  email: string;
  authDisplayName?: string | null;
  existingProfile?: UserProfile | null;
  pendingInvitation?: UserInvitationRecord | null;
}): InvitationClaimResolution {
  const cleanEmail = normalizeEmailAddress(params.email);

  if (isPrimarySuperAdminEmail(cleanEmail)) {
    return {
      shouldClaimInvitation: false,
      role: 'ADMIN',
      organizationId: params.existingProfile?.organizationId || SU_GLORIA_ORG_ID,
      displayName:
        params.authDisplayName ||
        params.existingProfile?.displayName ||
        'Andry Gallardo',
    };
  }

  const inv = params.pendingInvitation;
  const invMatches = Boolean(
    inv &&
      inv.status === 'INVITACION_ENVIADA' &&
      normalizeEmailAddress(inv.email) === cleanEmail
  );

  if (inv && invMatches) {
    const orgId = inv.organizationId || SU_GLORIA_ORG_ID;
    const resolvedDisplayName =
      params.authDisplayName?.trim() ||
      inv.displayName?.trim() ||
      params.existingProfile?.displayName?.trim() ||
      cleanEmail.split('@')[0] ||
      'Usuario AxyCore';

    const membershipId = `${orgId}_${params.uid}`;
    return {
      shouldClaimInvitation: true,
      role: inv.role,
      organizationId: orgId,
      displayName: resolvedDisplayName,
      invitationId: inv.id,
      invitedBy: inv.invitedBy,
      invitedAt: inv.invitedAt,
      membershipPayload: {
        id: membershipId,
        organizationId: orgId,
        organizationName: inv.organizationName || SU_GLORIA_MANO_AMIGA_ORG.name,
        userId: params.uid,
        userEmail: cleanEmail,
        userDisplayName: resolvedDisplayName,
        role: inv.role,
        status: 'ACTIVE',
        granularPermissions:
          DEFAULT_GRANULAR_PERMISSIONS_BY_ROLE[inv.role] || ['CONSULTAR'],
        isPrimaryAdmin: inv.role === 'ADMIN',
        invitationId: inv.id,
        invitedBy: inv.invitedBy,
        createdBy: params.uid,
      } as Omit<OrganizationMembershipRecord, 'createdAt' | 'updatedAt'> & {
        invitationId?: string;
        createdBy?: string;
      },
    };
  }

  if (params.existingProfile) {
    return {
      shouldClaimInvitation: false,
      role: params.existingProfile.role,
      organizationId: params.existingProfile.organizationId || SU_GLORIA_ORG_ID,
      displayName:
        params.existingProfile.displayName ||
        params.authDisplayName ||
        cleanEmail.split('@')[0] ||
        'Usuario AxyCore',
      invitationId: params.existingProfile.invitationId,
      invitedBy: params.existingProfile.invitedBy,
      invitedAt: params.existingProfile.invitedAt,
    };
  }

  return {
    shouldClaimInvitation: false,
    role: 'EXTERNAL_CLIENT',
    organizationId: SU_GLORIA_ORG_ID,
    displayName:
      params.authDisplayName?.trim() || cleanEmail.split('@')[0] || 'Usuario AxyCore',
  };
}

/**
 * Deduplicates corporate users by normalized email so that once an invited user
 * activates their account with a real Firebase Auth UID, the pre-provisioned `usr_*`
 * placeholder row is superseded cleanly in the admin table.
 */
export function deduplicateCorporateUsers(users: UserProfile[]): UserProfile[] {
  const byKey = new Map<string, UserProfile>();

  const scoreUser = (u: UserProfile): number => {
    let score = 0;
    if (isPrimarySuperAdminEmail(u.email) || u.isSuperAdmin) score += 1000;
    if (!u.uid.startsWith('usr_')) score += 100;
    if (u.invitationStatus === 'CONFIRMADA') score += 30;
    if (u.status === 'ACTIVE') score += 20;
    return score;
  };

  for (const user of users) {
    const emailKey = normalizeEmailAddress(user.email);
    const key = emailKey || user.uid;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, user);
      continue;
    }
    const existingScore = scoreUser(existing);
    const candidateScore = scoreUser(user);
    if (
      candidateScore > existingScore ||
      (candidateScore === existingScore && (user.updatedAt || '') > (existing.updatedAt || ''))
    ) {
      byKey.set(key, user);
    }
  }

  return Array.from(byKey.values());
}

