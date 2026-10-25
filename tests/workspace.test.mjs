import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkspacePreferences, readWorkspacePreferences, saveWorkspacePreferences } from '../src/workspace.ts';

function fixture(spaceRows, settingsRows, profiles) {
  const calls = [];
  const rows = { finance_spaces: spaceRows, finance_space_settings: settingsRows, finance_user_profiles: profiles };
  const client = {
    from(table) {
      return {
        select() { return { eq(column, value) {
          calls.push({ table, action: 'read', column, value });
          const data = rows[table].find(row => row[column] === value) || null;
          return { single: async () => ({ data, error: data ? null : new Error('missing') }),
            maybeSingle: async () => ({ data, error: null }) };
        } }; },
        upsert(row) { calls.push({ table, action: 'write', row }); return Promise.resolve({ error: null }); },
      };
    },
    rpc(name, args) { calls.push({ action: 'rpc', name, args }); return Promise.resolve({ error: null }); },
  };
  return { client, calls };
}

test('independent spaces load their own name, currencies and feature preferences', async () => {
  const { client, calls } = fixture(
    [{ id: 'home', name: 'Dorian y Dani' }, { id: 'friend', name: 'Casa de Camila' }],
    [{ space_id: 'home', show_giros: true, show_business: true,
      enabled_currencies: ['ARS', 'BOB', 'USD', 'USDT'] },
    { space_id: 'friend', show_giros: false, show_business: false,
      enabled_currencies: ['BOB', 'USD'] }],
    [{ user_id: 'dorian', display_name: 'Dorian' }, { user_id: 'camila', display_name: 'Camila' }],
  );
  const home = await readWorkspacePreferences(client, 'home', 'dorian');
  const friend = await readWorkspacePreferences(client, 'friend', 'camila');
  assert.equal(home.name, 'Dorian y Dani');
  assert.deepEqual(home.enabledCurrencies, ['ARS', 'BOB', 'USD', 'USDT']);
  assert.equal(friend.displayName, 'Camila');
  assert.equal(friend.showGiros, false);
  assert.equal(friend.showBusiness, false);
  assert.deepEqual(friend.enabledCurrencies, ['BOB', 'USD']);
  assert.equal(calls.some(call => call.table === 'finance_spaces' && call.value === 'home'), true);
});

test('a member updates only their own profile; only an owner sends shared preferences', async () => {
  const { client, calls } = fixture([], [], []);
  const current = defaultWorkspacePreferences();
  const next = { ...current, name: 'Casa', displayName: 'Camila', enabledCurrencies: ['BOB', 'USD'] };
  await saveWorkspacePreferences(client, 'friend', 'camila', current, next, false);
  assert.deepEqual(calls.map(call => call.action), ['write']);
  assert.equal(calls[0].row.user_id, 'camila');
  await saveWorkspacePreferences(client, 'friend', 'camila', current, next, true);
  assert.equal(calls.at(-1).name, 'configure_finance_space');
  assert.deepEqual(calls.at(-1).args.p_enabled_currencies, ['BOB', 'USD']);
});
