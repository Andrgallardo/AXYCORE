import { describe, expect, it } from 'vitest';
import {
  anchorPositionOnResize,
  BELA_PREFS_STORAGE_KEY,
  clampFloatingPosition,
  DEFAULT_BELA_PREFERENCES,
  getStoredBelaPreferences,
  resolveDockedCornerPosition,
  saveBelaPreferences,
} from '../utils/belaPreferences';

function makeMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe('Preferencias de comportamiento del Asistente Bela (Flotante vs Anclado)', () => {
  it('usa modo Flotante en esquina inferior derecha por defecto y persiste cambios a Anclado', () => {
    const storage = makeMemoryStorage();
    expect(getStoredBelaPreferences(storage)).toEqual(DEFAULT_BELA_PREFERENCES);

    const saved = saveBelaPreferences({ mode: 'docked', corner: 'top-left' }, storage);
    expect(saved).toEqual({ mode: 'docked', corner: 'top-left' });
    expect(getStoredBelaPreferences(storage)).toEqual({ mode: 'docked', corner: 'top-left' });
  });

  it('recupera valores seguros si el almacenamiento contiene JSON corrupto o valores inválidos', () => {
    const storage = makeMemoryStorage();
    storage.setItem(BELA_PREFS_STORAGE_KEY, '{not-json');
    expect(getStoredBelaPreferences(storage)).toEqual(DEFAULT_BELA_PREFERENCES);

    storage.setItem(
      BELA_PREFS_STORAGE_KEY,
      JSON.stringify({ mode: 'invalid_mode', corner: 'center' })
    );
    expect(getStoredBelaPreferences(storage)).toEqual(DEFAULT_BELA_PREFERENCES);
  });

  it('resuelve correctamente las 4 esquinas ancladas respetando márgenes seguros de cabecera', () => {
    const vw = 1440;
    const vh = 900;
    const w = 160;
    const h = 56;

    expect(resolveDockedCornerPosition('top-left', w, h, vw, vh)).toEqual({ x: 20, y: 76 });
    expect(resolveDockedCornerPosition('top-right', w, h, vw, vh)).toEqual({ x: 1260, y: 76 });
    expect(resolveDockedCornerPosition('bottom-left', w, h, vw, vh)).toEqual({ x: 20, y: 824 });
    expect(resolveDockedCornerPosition('bottom-right', w, h, vw, vh)).toEqual({ x: 1260, y: 824 });
  });

  it('mantiene a Bela dentro del viewport al arrastrar o al expandir desde la esquina derecha', () => {
    expect(clampFloatingPosition({ x: -100, y: 2000 }, 160, 56, 390, 844)).toEqual({
      x: 12,
      y: 776,
    });

    // Botón en esquina inferior derecha -> al abrir panel 396x520 se ancla sin salirse del borde
    const expanded = anchorPositionOnResize(
      { x: 1260, y: 824 },
      160,
      56,
      396,
      520,
      1440,
      900
    );
    expect(expanded.x + 396).toBeLessThanOrEqual(1440 - 12);
    expect(expanded.y + 520).toBeLessThanOrEqual(900 - 12);
    expect(expanded.x).toBe(1024);
    expect(expanded.y).toBe(360);
  });
});
