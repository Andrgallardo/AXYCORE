import { describe, expect, it } from 'vitest';
import {
  buildBreadcrumbsForSection,
  SECTION_HIERARCHY,
} from '../engine/navigationBreadcrumbs';
import { canRoleAccessSection } from '../engine/rbac';
import {
  checkTenantSectionAccess,
  SU_GLORIA_MANO_AMIGA_ORG,
} from '../engine/multiTenantEngine';
import {
  computeGuideAccessSummary,
  filterSystemGuideAreas,
  SYSTEM_GUIDE_AREAS,
  SYSTEM_GUIDE_FLOWS,
  SYSTEM_TECHNICAL_PILLARS,
} from '../engine/systemGuideCatalog';
import { ROLE_LABELS, type UserRole } from '../types/axycore';

describe('Guía de AxyCore Catalog & Routing Integrity', () => {
  it('references only valid NavSectionId entries registered in SECTION_HIERARCHY', () => {
    const allSectionIds = Object.keys(SECTION_HIERARCHY);

    for (const area of SYSTEM_GUIDE_AREAS) {
      expect(area.items.length).toBeGreaterThan(0);
      for (const item of area.items) {
        expect(allSectionIds).toContain(item.sectionId);
      }
    }

    for (const flow of SYSTEM_GUIDE_FLOWS) {
      expect(flow.steps.length).toBeGreaterThan(0);
      for (const step of flow.steps) {
        expect(allSectionIds).toContain(step.sectionId);
      }
    }

    for (const pillar of SYSTEM_TECHNICAL_PILLARS) {
      if (pillar.relatedSection) {
        expect(allSectionIds).toContain(pillar.relatedSection);
      }
    }
  });

  it('grants system_guide access to all internal roles and active organizations', () => {
    const roles = Object.keys(ROLE_LABELS) as UserRole[];
    for (const role of roles) {
      if (role === 'EXTERNAL_CLIENT') {
        expect(canRoleAccessSection(role, 'system_guide')).toBe(false);
      } else {
        expect(canRoleAccessSection(role, 'system_guide')).toBe(true);
      }
    }

    const tenantAccess = checkTenantSectionAccess({
      section: 'system_guide',
      organization: SU_GLORIA_MANO_AMIGA_ORG,
      isSuperAdmin: false,
    });
    expect(tenantAccess.allowed).toBe(true);

    const trail = buildBreadcrumbsForSection({
      activeSection: 'system_guide',
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });
    expect(trail.map((s) => s.label)).toEqual(['Inicio', 'Guía de AxyCore']);
  });

  it('filters areas accurately by domain and search query without false positives', () => {
    const dgiiMatch = filterSystemGuideAreas({
      query: 'Ley 32-23',
      domain: 'ALL',
    });
    expect(dgiiMatch.some((a) => a.id === 'operaciones')).toBe(true);
    expect(
      dgiiMatch.flatMap((a) => a.items).some((i) => i.sectionId === 'ecf_dashboard')
    ).toBe(true);

    const alteraMatch = filterSystemGuideAreas({
      query: 'Universos Alternativos',
      domain: 'INTELIGENCIA_ADMIN',
    });
    expect(alteraMatch).toHaveLength(1);
    expect(alteraMatch[0].items.map((i) => i.sectionId)).toEqual(['intelligence_altera']);

    const emptyMatch = filterSystemGuideAreas({
      query: 'termino_inexistente_xyz_999',
      domain: 'ALL',
    });
    expect(emptyMatch).toHaveLength(0);
  });

  it('computes role-aware access coverage summary accurately', () => {
    const adminSummary = computeGuideAccessSummary({
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });
    const cashierSummary = computeGuideAccessSummary({
      canAccessSection: (s) => canRoleAccessSection('CASHIER', s),
    });

    expect(adminSummary.totalAreas).toBe(9);
    expect(adminSummary.accessibleScreens).toBeGreaterThan(cashierSummary.accessibleScreens);
    expect(
      cashierSummary.accessibleScreens + cashierSummary.restrictedByRoleOrLicense
    ).toBe(cashierSummary.totalScreens);
  });
});
