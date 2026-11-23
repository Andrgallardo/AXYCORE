import { describe, expect, it } from 'vitest';
import {
  mapProductCodeForCurrency,
  matchesPendingCurrencyTarget,
  normalizeClientName,
} from '../services/loanCurrencyCorrectionService';

describe('loanCurrencyCorrectionService helpers', () => {
  it('normalizes accents, punctuation and whitespace', () => {
    expect(normalizeClientName('  José   Pulus  ')).toBe('jose pulus');
    expect(normalizeClientName('IAN MICEL, FRANCISCO-MADERA')).toBe('ian micel francisco madera');
  });

  it('maps product codes consistently between DOP and USD', () => {
    expect(mapProductCodeForCurrency('PERSONAL_DOP', 'USD')).toBe('PERSONAL_USD');
    expect(mapProductCodeForCurrency('EMPRESARIAL_DOP', 'USD')).toBe('EMPRESARIAL_USD');
    expect(mapProductCodeForCurrency('PERSONAL_USD', 'DOP')).toBe('PERSONAL_DOP');
    expect(mapProductCodeForCurrency('EMPRESARIAL_USD', 'DOP')).toBe('EMPRESARIAL_DOP');
    expect(mapProductCodeForCurrency(undefined, 'USD')).toBe('PERSONAL_USD');
  });

  it('matches Jose Pulus across accents, order and minor spelling variants', () => {
    expect(matchesPendingCurrencyTarget('Jose Pulus')?.key).toBe('jose_pulus');
    expect(matchesPendingCurrencyTarget('JOSÉ MANUEL PULUS')?.key).toBe('jose_pulus');
    expect(matchesPendingCurrencyTarget('Pulus, Jose')?.key).toBe('jose_pulus');
    expect(matchesPendingCurrencyTarget('Jose Pullus')?.key).toBe('jose_pulus');
  });

  it('matches Ian Micel Francisco Madera across variants and partial surnames', () => {
    expect(matchesPendingCurrencyTarget('Ian Micel Francisco Madera')?.key).toBe(
      'ian_micel_francisco_madera'
    );
    expect(matchesPendingCurrencyTarget('IAN MISAEL FRANCISCO MADERA')?.key).toBe(
      'ian_micel_francisco_madera'
    );
    expect(matchesPendingCurrencyTarget('Ian Michel Francisco')?.key).toBe(
      'ian_micel_francisco_madera'
    );
    expect(matchesPendingCurrencyTarget('Francisco Madera, Ian Micel')?.key).toBe(
      'ian_micel_francisco_madera'
    );
  });

  it('does not falsely match unrelated client names', () => {
    expect(matchesPendingCurrencyTarget('Jose Polanco')).toBeNull();
    expect(matchesPendingCurrencyTarget('Juan Francisco Perez')).toBeNull();
    expect(matchesPendingCurrencyTarget('Maria Madera')).toBeNull();
    expect(matchesPendingCurrencyTarget('Ian Rodriguez')).toBeNull();
    expect(matchesPendingCurrencyTarget('')).toBeNull();
  });
});
