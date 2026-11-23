export const BELA_PREFS_STORAGE_KEY = 'axycore_bela_behavior_pref_v1';
export const BELA_POSITION_STORAGE_KEY = 'axycore_bela_floating_pos_v1';
export const BELA_PREFS_CHANGE_EVENT = 'axycore:bela-preferences-changed';

export type BelaBehaviorMode = 'floating' | 'docked';

export type BelaDockedCorner =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

export interface BelaUserPreferences {
  mode: BelaBehaviorMode;
  corner: BelaDockedCorner;
}

export interface FloatingPos {
  x: number;
  y: number;
}

export const DEFAULT_BELA_PREFERENCES: BelaUserPreferences = {
  mode: 'floating',
  corner: 'bottom-right',
};

const VALID_MODES: ReadonlySet<string> = new Set(['floating', 'docked']);
const VALID_CORNERS: ReadonlySet<string> = new Set([
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]);

export function getStoredBelaPreferences(
  storage?: Pick<Storage, 'getItem'> | null
): BelaUserPreferences {
  const targetStorage =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined'
      ? window.localStorage
      : null;

  if (!targetStorage) return { ...DEFAULT_BELA_PREFERENCES };

  try {
    const raw = targetStorage.getItem(BELA_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BELA_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<BelaUserPreferences>;
    const mode: BelaBehaviorMode =
      typeof parsed.mode === 'string' && VALID_MODES.has(parsed.mode)
        ? (parsed.mode as BelaBehaviorMode)
        : DEFAULT_BELA_PREFERENCES.mode;
    const corner: BelaDockedCorner =
      typeof parsed.corner === 'string' && VALID_CORNERS.has(parsed.corner)
        ? (parsed.corner as BelaDockedCorner)
        : DEFAULT_BELA_PREFERENCES.corner;
    return { mode, corner };
  } catch {
    return { ...DEFAULT_BELA_PREFERENCES };
  }
}

export function saveBelaPreferences(
  prefs: BelaUserPreferences,
  storage?: Pick<Storage, 'setItem'> | null
): BelaUserPreferences {
  const normalized: BelaUserPreferences = {
    mode: VALID_MODES.has(prefs.mode) ? prefs.mode : DEFAULT_BELA_PREFERENCES.mode,
    corner: VALID_CORNERS.has(prefs.corner)
      ? prefs.corner
      : DEFAULT_BELA_PREFERENCES.corner,
  };

  const targetStorage =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined'
      ? window.localStorage
      : null;

  if (targetStorage) {
    try {
      targetStorage.setItem(BELA_PREFS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore storage quota/privacy mode errors
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<BelaUserPreferences>(BELA_PREFS_CHANGE_EVENT, {
        detail: normalized,
      })
    );
  }

  return normalized;
}

export function clearSavedBelaFloatingPosition(
  storage?: Pick<Storage, 'removeItem'> | null
): void {
  const targetStorage =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined'
      ? window.localStorage
      : null;

  if (targetStorage) {
    try {
      targetStorage.removeItem(BELA_POSITION_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<BelaUserPreferences>(BELA_PREFS_CHANGE_EVENT, {
        detail: getStoredBelaPreferences(),
      })
    );
  }
}

export function clampFloatingPosition(
  pos: FloatingPos,
  widgetWidth: number,
  widgetHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 12
): FloatingPos {
  const maxX = Math.max(margin, viewportWidth - widgetWidth - margin);
  const maxY = Math.max(margin, viewportHeight - widgetHeight - margin);
  return {
    x: Math.round(Math.min(Math.max(pos.x, margin), maxX)),
    y: Math.round(Math.min(Math.max(pos.y, margin), maxY)),
  };
}

export function anchorPositionOnResize(
  prevPos: FloatingPos,
  prevWidth: number,
  prevHeight: number,
  nextWidth: number,
  nextHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  margin = 12
): FloatingPos {
  const centerX = prevPos.x + prevWidth / 2;
  const centerY = prevPos.y + prevHeight / 2;
  const preferRight = centerX >= viewportWidth / 2;
  const preferBottom = centerY >= viewportHeight / 2;

  const targetX = preferRight ? prevPos.x + prevWidth - nextWidth : prevPos.x;
  const targetY = preferBottom ? prevPos.y + prevHeight - nextHeight : prevPos.y;

  return clampFloatingPosition(
    { x: targetX, y: targetY },
    nextWidth,
    nextHeight,
    viewportWidth,
    viewportHeight,
    margin
  );
}

export function resolveDockedCornerPosition(
  corner: BelaDockedCorner,
  widgetWidth: number,
  widgetHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  options?: { edgeMargin?: number; topSafeMargin?: number }
): FloatingPos {
  const edge = options?.edgeMargin ?? 20;
  const topSafe = options?.topSafeMargin ?? (viewportWidth < 640 ? 68 : 76);

  const isRight = corner === 'top-right' || corner === 'bottom-right';
  const isBottom = corner === 'bottom-left' || corner === 'bottom-right';

  const rawX = isRight ? viewportWidth - widgetWidth - edge : edge;
  const rawY = isBottom ? viewportHeight - widgetHeight - edge : topSafe;

  return clampFloatingPosition(
    { x: rawX, y: rawY },
    widgetWidth,
    widgetHeight,
    viewportWidth,
    viewportHeight,
    12
  );
}
