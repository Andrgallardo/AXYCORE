import { describe, expect, it } from 'vitest';
import {
  buildSitemapGraph,
  filterSitemapGraph,
  SITEMAP_DATA_CONNECTIONS,
  SITEMAP_DOMAINS,
} from '../engine/systemSitemapEngine';
import { buildBreadcrumbsForSection, SECTION_HIERARCHY } from '../engine/navigationBreadcrumbs';
import { canRoleAccessSection } from '../engine/rbac';
import { checkTenantSectionAccess, SU_GLORIA_MANO_AMIGA_ORG } from '../engine/multiTenantEngine';

describe('System Sitemap Engine & Navigation Integration', () => {
  it('models all 9 architectural domains and includes system_sitemap under inteligencia', () => {
    expect(SITEMAP_DOMAINS).toHaveLength(9);
    expect(SITEMAP_DATA_CONNECTIONS.length).toBeGreaterThanOrEqual(10);

    const graph = buildSitemapGraph({
      canAccessSection: () => true,
      getSectionTenantAccess: () => ({ allowed: true }),
      isPlatformAdminPortal: true,
      roleLabel: 'Administrador del Sistema',
    });

    const intelDomain = graph.find((d) => d.domain.key === 'inteligencia');
    expect(intelDomain).toBeDefined();
    const sitemapNode = intelDomain?.nodes.find((n) => n.sectionId === 'system_sitemap');
    expect(sitemapNode).toBeDefined();
    expect(sitemapNode?.label).toBe('Mapa del Sistema');
    expect(sitemapNode?.accessible).toBe(true);
    expect(sitemapNode?.breadcrumbPath).toEqual(['Inicio', 'Inteligencia y Control Institucional', 'Mapa del Sistema']);
  });

  it('covers every NavSectionId defined in SECTION_HIERARCHY without orphans', () => {
    const graph = buildSitemapGraph({
      canAccessSection: () => true,
      getSectionTenantAccess: () => ({ allowed: true }),
      isPlatformAdminPortal: true,
      roleLabel: 'Administrador',
    });

    const graphIds = new Set(graph.flatMap((d) => d.nodes.map((n) => n.sectionId)));
    const hierarchyIds = Object.keys(SECTION_HIERARCHY);
    for (const id of hierarchyIds) {
      expect(graphIds.has(id as never)).toBe(true);
    }
  });

  it('respects RBAC, tenant licensing, and live metric counts', () => {
    const graph = buildSitemapGraph({
      canAccessSection: (sec) => canRoleAccessSection('COLLECTION_AGENT', sec),
      getSectionTenantAccess: (sec) =>
        checkTenantSectionAccess({
          section: sec,
          organization: SU_GLORIA_MANO_AMIGA_ORG,
          isSuperAdmin: false,
        }),
      isPlatformAdminPortal: false,
      roleLabel: 'Gestor de Cobros',
      liveMetrics: {
        applicationsCount: 12,
        activeLoansCount: 45,
        collectionAccountsCount: 30,
        ecfDocumentsCount: 8,
      },
    });

    const inicio = graph.find((d) => d.domain.key === 'inicio');
    const platformNode = inicio?.nodes.find((n) => n.sectionId === 'platform_control');
    expect(platformNode?.accessible).toBe(false);

    const intel = graph.find((d) => d.domain.key === 'inteligencia');
    const sitemapNode = intel?.nodes.find((n) => n.sectionId === 'system_sitemap');
    expect(sitemapNode?.accessible).toBe(true);

    const cartera = graph.find((d) => d.domain.key === 'cartera');
    const dailyNode = cartera?.nodes.find((n) => n.sectionId === 'cobranza_daily');
    expect(dailyNode?.liveCount).toBe(30);
    expect(dailyNode?.liveCountLabel).toBe('cuentas');
  });

  it('filters domains by query, architectural layer, and access status', () => {
    const graph = buildSitemapGraph({
      canAccessSection: (sec) => canRoleAccessSection('CREDIT_ANALYST', sec),
      getSectionTenantAccess: (sec) =>
        checkTenantSectionAccess({
          section: sec,
          organization: SU_GLORIA_MANO_AMIGA_ORG,
          isSuperAdmin: false,
        }),
      isPlatformAdminPortal: false,
      roleLabel: 'Analista de Crédito',
    });

    const byQuery = filterSitemapGraph({
      domains: graph,
      query: 'ALTERA',
      layer: 'ALL',
      accessFilter: 'ALL',
    });
    expect(byQuery.length).toBe(1);
    expect(byQuery[0].domain.key).toBe('inteligencia');

    const byLayer = filterSitemapGraph({
      domains: graph,
      query: '',
      layer: 'ACCOUNTING_DGII',
      accessFilter: 'ALL',
    });
    expect(byLayer.every((d) => d.domain.layer === 'ACCOUNTING_DGII')).toBe(true);

    const onlyAccessible = filterSitemapGraph({
      domains: graph,
      query: '',
      layer: 'ALL',
      accessFilter: 'ACCESSIBLE',
    });
    expect(onlyAccessible.flatMap((d) => d.nodes).every((n) => n.accessible)).toBe(true);
  });

  it('builds valid clickable breadcrumbs for system_sitemap', () => {
    const crumbs = buildBreadcrumbsForSection({
      activeSection: 'system_sitemap',
      canAccessSection: (sec) => canRoleAccessSection('ADMIN', sec),
    });
    expect(crumbs.map((c) => c.label)).toEqual(['Inicio', 'Inteligencia y Control Institucional', 'Mapa del Sistema']);
    expect(crumbs[crumbs.length - 1].isCurrent).toBe(true);
  });
});
