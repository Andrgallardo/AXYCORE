import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyThemeToDocument,
  getStoredThemePreference,
  saveAndApplyThemePreference,
  THEME_STORAGE_KEY,
} from '../utils/themePreferences';

function createMemoryStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    snapshot() {
      return Object.fromEntries(store.entries());
    },
  };
}

function createFakeRootElement() {
  const classes = new Set<string>();
  return {
    classList: {
      add: (cls: string) => classes.add(cls),
      remove: (cls: string) => classes.delete(cls),
      contains: (cls: string) => classes.has(cls),
    },
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
  };
}

describe('Persistent Theme Preferences (Dark / Light Mode + Tailwind .dark)', () => {
  it('defaults to light when no preference is stored and reads dark when persisted', () => {
    const emptyStorage = createMemoryStorage();
    expect(getStoredThemePreference(emptyStorage)).toBe('light');

    const darkStorage = createMemoryStorage({ [THEME_STORAGE_KEY]: 'dark' });
    expect(getStoredThemePreference(darkStorage)).toBe('dark');

    const lightStorage = createMemoryStorage({ [THEME_STORAGE_KEY]: 'light' });
    expect(getStoredThemePreference(lightStorage)).toBe('light');
  });

  it('handles storage read/write errors gracefully without throwing', () => {
    const brokenStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(getStoredThemePreference(brokenStorage)).toBe('light');

    const fakeRoot = createFakeRootElement();
    expect(() =>
      saveAndApplyThemePreference('dark', {
        storage: brokenStorage,
        root: fakeRoot as unknown as HTMLElement,
        metaThemeColor: null,
      })
    ).not.toThrow();
    expect(fakeRoot.classList.contains('dark')).toBe(true);
  });

  it('persists theme choice in localStorage and toggles .dark class, dataset, colorScheme, and meta theme-color', () => {
    const storage = createMemoryStorage();
    const fakeRoot = createFakeRootElement();
    const fakeMeta = { content: '#f4f7fc' } as HTMLMetaElement;

    saveAndApplyThemePreference('dark', {
      storage,
      root: fakeRoot as unknown as HTMLElement,
      metaThemeColor: fakeMeta,
    });

    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(fakeRoot.classList.contains('dark')).toBe(true);
    expect(fakeRoot.dataset.theme).toBe('dark');
    expect(fakeRoot.style.colorScheme).toBe('dark');
    expect(fakeMeta.content).toBe('#030816');

    saveAndApplyThemePreference('light', {
      storage,
      root: fakeRoot as unknown as HTMLElement,
      metaThemeColor: fakeMeta,
    });

    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(fakeRoot.classList.contains('dark')).toBe(false);
    expect(fakeRoot.dataset.theme).toBe('light');
    expect(fakeRoot.style.colorScheme).toBe('light');
    expect(fakeMeta.content).toBe('#f4f7fc');
  });

  it('applies @custom-variant dark in src/index.css so Tailwind v4 dark:* classes respond to .dark', () => {
    const cssPath = path.resolve(process.cwd(), 'src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    expect(cssContent).toContain('@import "tailwindcss";');
    expect(cssContent).toContain('@custom-variant dark (&:where(.dark, .dark *));');

    const fakeRoot = createFakeRootElement();
    applyThemeToDocument('dark', fakeRoot as unknown as HTMLElement, null);
    expect(fakeRoot.classList.contains('dark')).toBe(true);
  });
});
