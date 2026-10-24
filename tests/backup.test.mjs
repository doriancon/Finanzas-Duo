import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceBackup, parseFinanceBackup } from '../src/backup.ts';
import { emptyData } from '../src/data.ts';

test('backup preserves the complete saved FinanceData without writing to storage', () => {
  const data = emptyData();
  data.accounts[0].opening = 125.5;
  data.entries.push({ id: 'giro-1', kind: 'giro', scope: 'giro', amount: 10, currency: 'ARS', accountId: 'ARS-efectivo', toAccountId: 'BOB-efectivo', received: 20, giroProfit: 2, description: 'Giro', date: '2026-10-23' });
  data.businessOpening.ARS = 100;
  data.goals.push({ id: 'meta-1', name: 'Viaje', currency: 'ARS', target: 1000, icon: 'plane', color: '#fff' });
  data.pasanaco = { id: 'p-1', name: 'Pasanaco', currency: 'ARS', amount: 50, frequency: 'weekly', startDate: '2026-10-01', sourceAccountId: 'ARS-efectivo' };
  const raw = JSON.stringify(data);
  const storage = { getItem: key => key === 'duo-v4-data' ? raw : null, setItem: () => assert.fail('Backup must never write to storage') };

  const backup = createFinanceBackup(storage, new Date('2026-10-23T12:00:00.000Z'));
  assert.equal(backup.format, 'duo-finance-backup');
  assert.equal(backup.version, 1);
  assert.equal(backup.storageKey, 'duo-v4-data');
  assert.equal(backup.exportedAt, '2026-10-23T12:00:00.000Z');
  assert.deepEqual(backup.data, data);
  assert.deepEqual(parseFinanceBackup(JSON.stringify(backup)), backup);
});

test('backup rejects absent or incomplete data rather than downloading a misleading file', () => {
  assert.throws(() => createFinanceBackup({ getItem: () => null }), /No hay datos/);
  assert.throws(() => createFinanceBackup({ getItem: () => '{' }), /JSON válido/);
  assert.throws(() => createFinanceBackup({ getItem: () => '{"entries":[]}' }), /incompletos/);
  assert.throws(() => parseFinanceBackup(JSON.stringify({ format: 'duo-finance-backup', version: 2, data: emptyData() })), /compatible/);
});
