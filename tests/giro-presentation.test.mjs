import test from 'node:test';
import assert from 'node:assert/strict';
import { formatGiroMoneyEdit, formatGiroMoneyInput, giroInputCaret, giroMoneyInputError, parseGiroMoneyInput, validGiroMoneyInput } from '../src/giro-money.ts';
import { sortedEntries } from '../src/entry-order.ts';
import { paginate } from '../src/domain.ts';

test('giro amounts group thousands while preserving typed decimal commas and zeros', () => {
  for (const [raw, expected] of [
    ['1000', '1.000'], ['10000', '10.000'], ['100000', '100.000'],
    ['1000000', '1.000.000'], ['1234567,50', '1.234.567,50'],
    ['1000,', '1.000,'], ['0,00', '0,00'], ['1234.56', '123.456'],
  ]) assert.equal(formatGiroMoneyInput(raw, 'ARS'), expected);
  assert.equal(parseGiroMoneyInput('1.234.567,50'), 1234567.5);
  assert.equal(giroInputCaret('1.234.567,50', 5), 7);
});

test('a formatted giro amount keeps accepting zeros and edits in the middle', () => {
  let value = '';
  for (const [digit, expected] of [
    ['2', '2'], ['0', '20'], ['0', '200'], ['0', '2.000'],
    ['0', '20.000'], ['0', '200.000'], ['0', '2.000.000'],
    ['0', '20.000.000'],
  ]) {
    value = formatGiroMoneyInput(value + digit, 'ARS');
    assert.equal(value, expected);
    assert.equal(giroInputCaret(value, value.replaceAll('.', '').length), value.length);
  }
  assert.equal(formatGiroMoneyInput('20.000.000,50', 'ARS'), '20.000.000,50');
  assert.equal(formatGiroMoneyInput('20.000.0000', 'ARS'), '200.000.000');
  assert.equal(formatGiroMoneyInput('200.0000.00', 'ARS'), '200.000.000');
  assert.equal(formatGiroMoneyInput('20.009.000', 'ARS'), '20.009.000');
  assert.equal(formatGiroMoneyInput('20.000.000'.slice(0, 3) + '9' + '20.000.000'.slice(3), 'ARS'), '209.000.000');
  assert.equal(formatGiroMoneyInput('0000', 'ARS'), '0.000');
  assert.deepEqual(formatGiroMoneyEdit('2.0000', 6, '2.000', 'ARS', 'insertText', '0'), { value: '20.000', caret: 6 });
  assert.deepEqual(formatGiroMoneyEdit('20.0000', 7, '20.000', 'ARS', 'insertText', '0'), { value: '200.000', caret: 7 });
  assert.deepEqual(formatGiroMoneyEdit('2.000.', 6, '2.000', 'ARS', 'insertText', '.'), { value: '2.000,', caret: 6 });
  assert.deepEqual(formatGiroMoneyEdit('1.2900', 4, '1.200', 'ARS', 'insertText', '9'), { value: '12.900', caret: 4 });
  assert.deepEqual(formatGiroMoneyEdit('2000', 1, '2.000', 'ARS', 'deleteContentBackward'), { value: '000', caret: 0 });
  assert.deepEqual(formatGiroMoneyEdit('2000', 1, '2.000', 'ARS', 'deleteContentForward'), { value: '200', caret: 1 });
});

test('giro input retains currency precision without rounding or changing account values', () => {
  assert.equal(formatGiroMoneyInput('1000,123', 'ARS'), '1.000,123');
  assert.match(giroMoneyInputError('1.000,123', 'ARS'), /2 decimales/);
  assert.equal(formatGiroMoneyInput('1000,123456', 'USDT'), '1.000,123456');
  assert.equal(formatGiroMoneyInput('1000,1234567', 'USDT'), '1.000,1234567');
  assert.match(giroMoneyInputError('1.000,1234567', 'USDT'), /6 decimales/);
  assert.equal(validGiroMoneyInput('1.000,123456', 'USDT'), true);
  assert.equal(validGiroMoneyInput('1.000,123456', 'ARS'), false);
  assert.equal(validGiroMoneyInput('0', 'ARS'), false);
  assert.equal(validGiroMoneyInput('0', 'ARS', true), true);
  assert.equal(formatGiroMoneyInput('-1000', 'ARS'), null);
  assert.equal(giroMoneyInputError('123.456.789.012.345.678.901', 'ARS').includes('18 dígitos'), true);
  assert.match(giroMoneyInputError('900.719.925.474.099,91', 'ARS'), /precisión/);
});

test('movement order uses movement date, creation time, then stable id before pagination', () => {
  const entries = [
    { id: 'old', date: '2026-10-22', createdAt: '2026-10-24T10:00:00Z' },
    { id: 'a', date: '2026-10-23', createdAt: '2026-10-23T11:00:00Z' },
    { id: 'new', date: '2026-10-23', createdAt: '2026-10-23T12:00:00Z' },
    { id: 'b', date: '2026-10-23', createdAt: '2026-10-23T11:00:00Z' },
  ];
  const sorted = sortedEntries(entries);
  assert.deepEqual(sorted.map(entry => entry.id), ['new', 'b', 'a', 'old']);
  assert.deepEqual(entries.map(entry => entry.id), ['old', 'a', 'new', 'b']);
  assert.deepEqual(paginate(sorted, 1, 10).visible.map(entry => entry.id), ['new', 'b', 'a', 'old']);
  assert.deepEqual(sortedEntries(entries.filter(entry => entry.id !== 'new')).map(entry => entry.id), ['b', 'a', 'old']);
  const many = Array.from({ length: 12 }, (_, index) => ({ id: `item-${index}`, date: '2026-10-23',
    createdAt: `2026-10-23T12:${String(index).padStart(2, '0')}:00Z` }));
  const filtered = sortedEntries(many.filter(entry => entry.id !== 'item-11'));
  assert.equal(paginate(filtered, 1, 10).visible[0].id, 'item-10');
  assert.equal(paginate(filtered, 2, 10).visible[0].id, 'item-0');
});
