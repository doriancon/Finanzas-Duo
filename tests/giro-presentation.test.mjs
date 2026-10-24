import test from 'node:test';
import assert from 'node:assert/strict';
import { formatGiroMoneyInput, giroInputCaret, parseGiroMoneyInput, validGiroMoneyInput } from '../src/giro-money.ts';
import { sortedEntries } from '../src/entry-order.ts';
import { paginate } from '../src/domain.ts';

test('giro amounts group thousands while preserving typed decimal commas and zeros', () => {
  for (const [raw, expected] of [
    ['1000', '1.000'], ['10000', '10.000'], ['100000', '100.000'],
    ['1000000', '1.000.000'], ['1234567,50', '1.234.567,50'],
    ['1000,', '1.000,'], ['0,00', '0,00'], ['1234.56', '1.234,56'],
  ]) assert.equal(formatGiroMoneyInput(raw, 'ARS'), expected);
  assert.equal(parseGiroMoneyInput('1.234.567,50'), 1234567.5);
  assert.equal(giroInputCaret('1.234.567,50', 5), 7);
});

test('giro input retains currency precision without rounding or changing account values', () => {
  assert.equal(formatGiroMoneyInput('1000,123', 'ARS'), null);
  assert.equal(formatGiroMoneyInput('1000,123456', 'USDT'), '1.000,123456');
  assert.equal(formatGiroMoneyInput('1000,1234567', 'USDT'), null);
  assert.equal(validGiroMoneyInput('1.000,123456', 'USDT'), true);
  assert.equal(validGiroMoneyInput('1.000,123456', 'ARS'), false);
  assert.equal(validGiroMoneyInput('0', 'ARS'), false);
  assert.equal(validGiroMoneyInput('0', 'ARS', true), true);
  assert.equal(formatGiroMoneyInput('-1000', 'ARS'), null);
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
