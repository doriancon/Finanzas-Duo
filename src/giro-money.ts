import type { Currency } from './domain.ts';

export const giroDecimalPlaces = (currency: Currency) => currency === 'USDT' ? 6 : 2;

// Conserva la coma y los ceros finales mientras se escribe; no redondea importes.
export function formatGiroMoneyInput(raw: string, currency: Currency): string | null {
  let input = raw.replace(/[\s\u00a0]/g, '');
  if (!/^[\d.,]*$/.test(input)) return null;
  if (!input.includes('.') && !input.includes(',')) {
    input = input.replace(/^0+(?=\d)/, '');
  } else if (!input.includes(',')) {
    const groups = input.split('.');
    if (!groups.slice(1).every(group => group.length === 3)) {
      const last = input.lastIndexOf('.');
      input = `${input.slice(0, last).replaceAll('.', '')},${input.slice(last + 1)}`;
    }
  }
  const parts = input.split(',');
  if (parts.length > 2) return null;
  const integer = parts[0].replaceAll('.', '').replace(/^0+(?=\d)/, '') || (parts.length === 2 ? '0' : '');
  const fraction = parts[1] || '';
  if (!/^\d*$/.test(fraction) || fraction.length > giroDecimalPlaces(currency)) return null;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return grouped + (parts.length === 2 ? `,${fraction}` : '');
}

export const parseGiroMoneyInput = (value: string) => Number(value.replaceAll('.', '').replace(',', '.'));

export function validGiroMoneyInput(value: string, currency: Currency, allowZero = false): boolean {
  const amount = parseGiroMoneyInput(value);
  return value !== '' && formatGiroMoneyInput(value, currency) === value &&
    Number.isFinite(amount) && (allowZero ? amount >= 0 : amount > 0);
}

// Mapea el cursor según los dígitos y la coma, ignorando los puntos agregados para miles.
export function giroInputCaret(formatted: string, significantCharacters: number): number {
  if (significantCharacters <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d|,/.test(formatted[i])) seen++;
    if (seen === significantCharacters) return i + 1;
  }
  return formatted.length;
}
