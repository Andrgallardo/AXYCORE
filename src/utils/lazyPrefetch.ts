import type { NavSectionId } from '../types/axycore';

const prefetchedKeys = new Set<string>();

function runOnce(key: string, loader: () => Promise<unknown>): void {
  if (prefetchedKeys.has(key)) return;
  prefetchedKeys.add(key);
  loader().catch(() => {
    // Allow retry on next user interaction if network hiccups
    prefetchedKeys.delete(key);
  });
}

export function scheduleIdleWork(callback: () => void, timeoutMs = 1200): () => void {
  if (typeof window === 'undefined') return () => {};
  const win = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };

  if (typeof win.requestIdleCallback === 'function') {
    const id = win.requestIdleCallback(callback, { timeout: timeoutMs });
    return () => {
      win.cancelIdleCallback?.(id);
    };
  }

  const timer = window.setTimeout(callback, 120);
  return () => window.clearTimeout(timer);
}

export function prefetchDirectorView(): void {
  runOnce('director_view', () => import('../components/DirectorSection'));
  runOnce('director_briefing', () => import('../components/director/DirectorBriefingReport'));
}

export function prefetchDirectorBriefing(): void {
  runOnce('director_briefing', () => import('../components/director/DirectorBriefingReport'));
}

export function prefetchDirectorHistory(): void {
  runOnce('director_history', () => import('../components/director/DirectorHistoryDrawer'));
}

export function prefetchExecutiveDashboard(): void {
  runOnce('executive_dashboard', () => import('../views/ExecutiveDashboardView'));
}

export function prefetchDashboardAnalytics(): void {
  runOnce('dashboard_perf_overview', () => import('../components/PerformanceOverviewWidget'));
}

export function prefetchDashboardOperations(): void {
  runOnce('dashboard_operations', () => import('../views/home/HomeOperationsPanels'));
}

export function prefetchDashboardIntelligence(): void {
  runOnce('dashboard_intelligence', () => import('../views/home/HomeIntelligenceAndAlerts'));
  prefetchDirectorView();
}

export function prefetchDashboardConfigurator(): void {
  runOnce(
    'dashboard_configurator',
    () => import('../views/home/DashboardWidgetConfiguratorModal')
  );
}

export function prefetchSectionChunk(sectionId: NavSectionId): void {
  switch (sectionId) {
    case 'director':
      prefetchDirectorView();
      break;
    case 'dashboard':
    case 'bela':
      prefetchExecutiveDashboard();
      break;
    case 'intelligence_dashboard':
      runOnce('intelligence_dashboard', () => import('../components/IntelligenceDashboardView'));
      break;
    default:
      break;
  }
}
