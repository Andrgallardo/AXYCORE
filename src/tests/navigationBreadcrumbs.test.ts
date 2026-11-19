import { describe, expect, it } from 'vitest';
import {
  buildBreadcrumbsForSection,
  isAdministrationSection,
} from '../engine/navigationBreadcrumbs';
import { canRoleAccessSection } from '../engine/rbac';

describe('Navigation Breadcrumbs Synchronization', () => {
  it('builds a 4-level breadcrumb trail for nested policy submenus in Administration', () => {
    const trail = buildBreadcrumbsForSection({
      activeSection: 'admin_risk_bands',
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });

    expect(trail.map((s) => s.label)).toEqual([
      'Inicio',
      'Administración',
      'Parámetros Crediticios',
      'Bandas de Riesgo y Tasas',
    ]);

    expect(trail[0].targetSection).toBe('dashboard');
    expect(trail[1].targetSection).toBe('admin_users');
    expect(trail[2].targetSection).toBe('policies');
    expect(trail[3].isCurrent).toBe(true);
    expect(trail[3].siblings?.map((s) => s.sectionId)).toEqual([
      'policies',
      'admin_risk_bands',
      'admin_product_limits',
      'admin_approval_matrix',
      'admin_workflow',
    ]);
  });

  it('builds 3-level trails for top-level Administration sections with sibling quick-jump lists', () => {
    const usersTrail = buildBreadcrumbsForSection({
      activeSection: 'admin_users',
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });

    expect(usersTrail.map((s) => s.label)).toEqual(['Inicio', 'Administración', 'Usuarios']);
    expect(usersTrail[2].isCurrent).toBe(true);
    expect(usersTrail[2].siblings?.map((s) => s.sectionId)).toEqual([
      'admin_users',
      'admin_roles',
      'policies',
      'cobranza_assignment',
      'cobranza_params',
      'admin_settings',
      'audit',
    ]);

    const auditTrail = buildBreadcrumbsForSection({
      activeSection: 'audit',
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });
    expect(auditTrail.map((s) => s.label)).toEqual(['Inicio', 'Administración', 'Auditoría']);
    expect(isAdministrationSection('audit')).toBe(true);
  });

  it('respects RBAC permissions when resolving Administration landing targets and siblings', () => {
    // AUDITOR can access policies, admin_roles, and audit, but NOT admin_users or admin_settings
    const trail = buildBreadcrumbsForSection({
      activeSection: 'admin_workflow',
      canAccessSection: (s) => canRoleAccessSection('AUDITOR', s),
    });

    expect(trail.map((s) => s.label)).toEqual([
      'Inicio',
      'Administración',
      'Parámetros Crediticios',
      'Flujo de Aprobación',
    ]);

    // Administration group target falls back to 'policies' instead of unauthorized 'admin_users'
    expect(trail[1].targetSection).toBe('policies');
    expect(trail[1].siblings?.map((s) => s.sectionId)).toEqual([
      'admin_roles',
      'policies',
      'cobranza_assignment',
      'cobranza_params',
      'audit',
    ]);
  });

  it('supports nested submenus in other operational groups (Clientes and Contabilidad)', () => {
    const accountingTrail = buildBreadcrumbsForSection({
      activeSection: 'accounting_payment_validation',
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });
    expect(accountingTrail.map((s) => s.label)).toEqual([
      'Inicio',
      'Operaciones Generales',
      'Contabilidad',
      'Pagos para Validar',
    ]);
    expect(accountingTrail[2].targetSection).toBe('accounting');

    const customersTrail = buildBreadcrumbsForSection({
      activeSection: 'customers_active',
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });
    expect(customersTrail.map((s) => s.label)).toEqual([
      'Inicio',
      'Clientes',
      'Todos los Clientes',
      'Activos',
    ]);
    expect(customersTrail[2].targetSection).toBe('customers');
  });

  it('places Asignación de Cartera and Parámetros de Cobranza in Administración, Contact Center as standalone, and Conciliación Bancaria inside Contabilidad', () => {
    const assignTrail = buildBreadcrumbsForSection({
      activeSection: 'cobranza_assignment',
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });
    expect(assignTrail.map((s) => s.label)).toEqual(['Inicio', 'Administración', 'Asignación de Cartera']);
    expect(isAdministrationSection('cobranza_assignment')).toBe(true);

    const paramsTrail = buildBreadcrumbsForSection({
      activeSection: 'cobranza_params',
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });
    expect(paramsTrail.map((s) => s.label)).toEqual(['Inicio', 'Administración', 'Parámetros de Cobranza']);
    expect(isAdministrationSection('cobranza_params')).toBe(true);

    const ccTrail = buildBreadcrumbsForSection({
      activeSection: 'cobranza_contact_center',
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });
    expect(ccTrail.map((s) => s.label)).toEqual(['Inicio', 'Contact Center', 'Contact Center KPIs']);

    const reconTrail = buildBreadcrumbsForSection({
      activeSection: 'cobranza_reconciliation',
      canAccessSection: (s) => canRoleAccessSection('ADMIN', s),
    });
    expect(reconTrail.map((s) => s.label)).toEqual([
      'Inicio',
      'Operaciones Generales',
      'Contabilidad',
      'Conciliación Bancaria',
    ]);
    expect(reconTrail[2].targetSection).toBe('accounting');
  });

  it('returns clean Inicio -> Dashboard trail on the root dashboard', () => {
    const trail = buildBreadcrumbsForSection({
      activeSection: 'dashboard',
      canAccessSection: () => true,
    });
    expect(trail.map((s) => s.label)).toEqual(['Inicio', 'Dashboard']);
    expect(trail[1].isCurrent).toBe(true);
  });
});
