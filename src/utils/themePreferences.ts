export const THEME_STORAGE_KEY = 'axycore_theme';

export type ThemeMode = 'light' | 'dark';

export function getStoredThemePreference(
  storage?: Pick<Storage, 'getItem'> | null
): ThemeMode {
  const targetStorage =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined'
      ? window.localStorage
      : null;

  if (!targetStorage) return 'light';
  try {
    return targetStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyThemeToDocument(
  mode: ThemeMode,
  root?: HTMLElement | null,
  metaThemeColor?: HTMLMetaElement | null
): void {
  const targetRoot =
    root !== undefined
      ? root
      : typeof document !== 'undefined'
      ? document.documentElement
      : null;

  if (targetRoot) {
    if (mode === 'dark') {
      targetRoot.classList.add('dark');
      targetRoot.classList.remove('light');
    } else {
      targetRoot.classList.remove('dark');
    }
    targetRoot.dataset.theme = mode;
    targetRoot.style.colorScheme = mode;
  }

  const targetMeta =
    metaThemeColor !== undefined
      ? metaThemeColor
      : typeof document !== 'undefined'
      ? (document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null)
      : null;

  if (targetMeta) {
    targetMeta.content = mode === 'dark' ? '#030816' : '#f4f7fc';
  }
}

export function saveAndApplyThemePreference(
  mode: ThemeMode,
  options?: {
    storage?: Pick<Storage, 'setItem'> | null;
    root?: HTMLElement | null;
    metaThemeColor?: HTMLMetaElement | null;
  }
): void {
  const targetStorage =
    options?.storage !== undefined
      ? options.storage
      : typeof window !== 'undefined'
      ? window.localStorage
      : null;

  if (targetStorage) {
    try {
      targetStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Ignore storage quota/privacy mode errors gracefully
    }
  }

  applyThemeToDocument(mode, options?.root, options?.metaThemeColor);
}
