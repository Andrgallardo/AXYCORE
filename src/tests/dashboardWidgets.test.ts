import { describe, expect, it } from 'vitest';
import {
  buildDashboardWidgetDocId,
  buildDefaultDashboardWidgetConfig,
  dashboardWidgetReducer,
  getRoleDashboardPolicy,
  sanitizeDashboardWidgetConfig,
} from '../engine/dashboardWidgetConfig';
import { canRoleAccessSection, hasRolePermission } from '../engine/rbac';
import type { UserRole } from '../types/axycore';

function policyFor(role: UserRole) {
  return getRoleDashboardPolicy({
    role,
    hasPermission: (p) => hasRolePermission(role, p),
    canAccessSection: (s) => canRoleAccessSection(role, s),
  });
}

describe('Dashboard Widget State Management Engine (RBAC + Drag & Drop + Hide)', () => {
  it('enforces distinct widget eligibility and defaults per operational role', () => {
    const adminPolicy = policyFor('ADMIN');
    expect(adminPolicy.canConfigure).toBe(true);
    expect(adminPolicy.allowedKpis).toEqual([
      'CARTERA_TOTAL',
      'CARTERA_VENCIDA',
      'DESEMBOLSOS',
      'RECUPERACION',
    ]);
    expect(adminPolicy.allowedAlerts.length).toBe(7);

    const collectorPolicy = policyFor('COLLECTION_AGENT');
    expect(collectorPolicy.canConfigure).toBe(true);
    expect(collectorPolicy.allowedKpis).toEqual([
      'RECUPERACION',
      'CARTERA_VENCIDA',
      'CARTERA_TOTAL',
    ]);
    expect(collectorPolicy.allowedKpis).not.toContain('DESEMBOLSOS');
    expect(collectorPolicy.allowedAlerts[0]).toBe('CUOTAS_VENCIDAS');
    expect(collectorPolicy.allowedAlerts).not.toContain('EVALUACION');

    const cashierPolicy = policyFor('CASHIER');
    expect(cashierPolicy.allowedKpis).toEqual(['RECUPERACION', 'CARTERA_VENCIDA']);
    expect(cashierPolicy.allowedAlerts).toEqual([
      'PROXIMO_VENCER',
      'CUOTAS_VENCIDAS',
      'PROMESAS_INCUMPLIDAS',
    ]);

    const formalizationPolicy = policyFor('FORMALIZATION');
    expect(formalizationPolicy.allowedKpis).not.toContain('CARTERA_VENCIDA');
    expect(formalizationPolicy.allowedAlerts).toEqual([
      'APROBACIONES',
      'EXPEDIENTES',
      'EVALUACION',
    ]);

    const clientPolicy = policyFor('EXTERNAL_CLIENT');
    expect(clientPolicy.canConfigure).toBe(false);
    expect(clientPolicy.lockedVisibleKpis).toEqual(['CARTERA_TOTAL']);
  });

  it('supports drag-and-drop reordering and step movement on Resumen Ejecutivo KPIs', () => {
    const policy = policyFor('RISK_OFFICER');
    let state = buildDefaultDashboardWidgetConfig({
      organizationId: 'org_axycore_main',
      userId: 'user_risk_1',
      policy,
    });

    // RISK_OFFICER starts with CARTERA_VENCIDA first
    expect(state.kpiOrder[0]).toBe('CARTERA_VENCIDA');

    // Drag RECUPERACION onto CARTERA_VENCIDA (slot 0)
    state = dashboardWidgetReducer(
      state,
      { type: 'REORDER_KPI', fromId: 'RECUPERACION', toId: 'CARTERA_VENCIDA' },
      policy
    );
    expect(state.kpiOrder).toEqual([
      'RECUPERACION',
      'CARTERA_VENCIDA',
      'CARTERA_TOTAL',
      'DESEMBOLSOS',
    ]);

    // Move CARTERA_VENCIDA one slot left
    state = dashboardWidgetReducer(
      state,
      { type: 'MOVE_KPI', id: 'CARTERA_VENCIDA', direction: -1 },
      policy
    );
    expect(state.kpiOrder[0]).toBe('CARTERA_VENCIDA');
    expect(state.kpiOrder[1]).toBe('RECUPERACION');
  });

  it('supports hiding, showing, and restoring widgets in Resumen Ejecutivo and Centro de Alertas', () => {
    const policy = policyFor('COLLECTION_COORDINATOR');
    let state = buildDefaultDashboardWidgetConfig({
      organizationId: 'org_axycore_main',
      userId: 'user_col_1',
      policy,
    });

    state = dashboardWidgetReducer(
      state,
      { type: 'TOGGLE_KPI_VISIBILITY', id: 'CARTERA_TOTAL' },
      policy
    );
    expect(state.hiddenKpis).toEqual(['CARTERA_TOTAL']);

    state = dashboardWidgetReducer(
      state,
      { type: 'TOGGLE_ALERT_VISIBILITY', id: 'PROXIMO_VENCER' },
      policy
    );
    state = dashboardWidgetReducer(
      state,
      { type: 'REORDER_ALERT', fromId: 'PROMESAS_INCUMPLIDAS', toId: 'CUOTAS_VENCIDAS' },
      policy
    );
    expect(state.hiddenAlerts).toEqual(['PROXIMO_VENCER']);
    expect(state.alertOrder[0]).toBe('PROMESAS_INCUMPLIDAS');

    state = dashboardWidgetReducer(state, { type: 'SHOW_ALL_KPIS' }, policy);
    state = dashboardWidgetReducer(state, { type: 'SHOW_ALL_ALERTS' }, policy);
    expect(state.hiddenKpis).toEqual([]);
    expect(state.hiddenAlerts).toEqual([]);

    // Reset restores role defaults
    state = dashboardWidgetReducer(
      state,
      { type: 'SET_ALERTS_VIEW_MODE', mode: 'FEED' },
      policy
    );
    expect(state.alertsViewMode).toBe('FEED');

    state = dashboardWidgetReducer(
      state,
      {
        type: 'RESET_TO_ROLE_DEFAULT',
        organizationId: 'org_axycore_main',
        userId: 'user_col_1',
      },
      policy
    );
    expect(state.alertOrder[0]).toBe('CUOTAS_VENCIDAS');
    expect(state.alertsViewMode).toBe('CARDS');
  });

  it('strips unauthorized KPIs and alerts when sanitizing remote config against a tighter role', () => {
    const cashierPolicy = policyFor('CASHIER');
    const sanitized = sanitizeDashboardWidgetConfig(
      {
        kpiOrder: ['DESEMBOLSOS', 'CARTERA_TOTAL', 'RECUPERACION', 'CARTERA_VENCIDA'],
        hiddenKpis: ['DESEMBOLSOS', 'RECUPERACION'],
        alertOrder: ['EVALUACION', 'CUOTAS_VENCIDAS', 'PROXIMO_VENCER'],
        hiddenAlerts: ['EVALUACION', 'CUOTAS_VENCIDAS'],
        alertsViewMode: 'FEED',
      },
      cashierPolicy,
      { organizationId: 'org_axycore_main', userId: 'user_cashier_1' }
    );

    expect(sanitized.kpiOrder).toEqual(['RECUPERACION', 'CARTERA_VENCIDA']);
    expect(sanitized.hiddenKpis).toEqual(['RECUPERACION']);
    expect(sanitized.alertOrder).toEqual([
      'CUOTAS_VENCIDAS',
      'PROXIMO_VENCER',
      'PROMESAS_INCUMPLIDAS',
    ]);
    expect(sanitized.hiddenAlerts).toEqual(['CUOTAS_VENCIDAS']);
    expect(sanitized.alertsViewMode).toBe('FEED');
  });

  it('prevents EXTERNAL_CLIENT from mutating widget configuration', () => {
    const clientPolicy = policyFor('EXTERNAL_CLIENT');
    const initial = buildDefaultDashboardWidgetConfig({
      organizationId: 'org_axycore_main',
      userId: 'client_1',
      policy: clientPolicy,
    });

    const afterHide = dashboardWidgetReducer(
      initial,
      { type: 'TOGGLE_KPI_VISIBILITY', id: 'CARTERA_TOTAL' },
      clientPolicy
    );
    expect(afterHide).toBe(initial);
    expect(afterHide.hiddenKpis).toEqual([]);
  });

  it('generates Firestore-safe deterministic document IDs scoped by org, user, and role', () => {
    const docId = buildDashboardWidgetDocId('org_axycore_main', 'uid.test/123', 'RISK_OFFICER');
    expect(docId).toMatch(/^[a-zA-Z0-9_-]{3,128}$/);
    expect(docId).toContain('RISK_OFFICER');
  });
});
