import type { Currency } from './domain.ts';

export const giroDecimalPlaces = (currency: Currency) => currency === 'USDT' ? 6 : 2;

// El punto siempre agrupa miles. La coma es el único separador decimal.
// Conserva todos los dígitos mientras se escribe, incluso ceros finales.
export function formatGiroMoneyInput(raw: string, _currency: Currency): string | null {
  const input = raw.replace(/[\s\u00a0]/g, '');
  if (!/^[\d.,]*$/.test(input)) return null;
  const parts = input.split(',');
  if (parts.length > 2) return null;
  const integer = parts[0].replaceAll('.', '') || (parts.length === 2 ? '0' : '');
  const fraction = parts[1] || '';
  if (!/^\d*$/.test(fraction)) return null;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return grouped + (parts.length === 2 ? `,${fraction}` : '');
}

export const parseGiroMoneyInput = (value: string) => Number(value.replaceAll('.', '').replace(',', '.'));

export function giroMoneyInputError(value: string, currency: Currency, allowZero = false): string | null {
  if (value === '' || formatGiroMoneyInput(value, currency) !== value)
    return 'Ingresá un importe válido usando coma para los decimales.';
  const [integer, fraction = ''] = value.replaceAll('.', '').split(',');
  const places = giroDecimalPlaces(currency);
  if (fraction.length > places)
    return `${currency} permite hasta ${places} decimales.`;
  if (integer.replace(/^0+/, '').length > 18)
    return 'El importe supera el máximo de 18 dígitos enteros de la base de datos.';
  const amount = parseGiroMoneyInput(value);
  if (!Number.isFinite(amount) || !(allowZero ? amount >= 0 : amount > 0))
    return allowZero ? 'El importe debe ser cero o mayor.' : 'El importe debe ser mayor que cero.';
  const exact = `${BigInt(integer || '0')}.${fraction.padEnd(places, '0')}`;
  if (amount.toFixed(places) !== exact)
    return 'El importe es demasiado grande para guardarlo con precisión. Ingresá uno menor.';
  return null;
}

export const validGiroMoneyInput = (value: string, currency: Currency, allowZero = false) =>
  giroMoneyInputError(value, currency, allowZero) === null;

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

export function formatGiroMoneyEdit(
  rawValue: string, selectionStart: number, previous: string, currency: Currency,
  inputType = '', inserted = '',
): { value: string; caret: number } | null {
  let raw = rawValue;
  let position = selectionStart;
  // Los teclados decimales pueden enviar punto; solo el punto recién escrito significa coma.
  if (inserted === '.' && raw[position - 1] === '.')
    raw = `${raw.slice(0, position - 1)},${raw.slice(position)}`;
  // Al borrar un punto generado para miles, borrar también el dígito esperado.
  if (raw.length === previous.length - 1 && raw.replaceAll('.', '') === previous.replaceAll('.', '')) {
    if (inputType === 'deleteContentBackward' && position > 0) {
      raw = raw.slice(0, position - 1) + raw.slice(position);
      position--;
    } else if (inputType === 'deleteContentForward' && position < raw.length)
      raw = raw.slice(0, position) + raw.slice(position + 1);
  }
  const value = formatGiroMoneyInput(raw, currency);
  if (value === null) return null;
  const significant = [...raw.slice(0, position)].filter(char => /\d|,/.test(char)).length;
  return { value, caret: giroInputCaret(value, significant) };
}
