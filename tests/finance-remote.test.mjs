import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyData } from '../src/data.ts';
import { acceptFinanceInvite, createFinanceInvite, findFinanceSpace, loadFinanceSpace, persistFinanceChange } from '../src/finance-remote.ts';
import { accountBalance } from '../src/domain.ts';

function clientFixture(members = []) {
  const calls = [];
  const client = {
    from(table) {
      return {
        select() { return { eq(column, value) { calls.push({ table, action: 'select', column, value });
          return { async maybeSingle() { return { data: members.find(member => member.user_id === value) || null, error: null }; } }; } }; },
        upsert(rows) { calls.push({ table, action: 'upsert', rows }); return Promise.resolve({ error: null }); },
        delete() { return { eq(column, value) { calls.push({ table, action: 'delete', column, value });
          return { eq() { return Promise.resolve({ error: null }); } }; } }; },
      };
    },
    rpc(name, args) { calls.push({ action: 'rpc', name, args }); return Promise.resolve({ error: null }); },
  };
  return { client, calls };
}

test('only a member can discover their shared space', async () => {
  const { client } = clientFixture([{ user_id: 'dorian', space_id: 'shared', role: 'owner' }]);
  assert.deepEqual(await findFinanceSpace(client, 'dorian'), { id: 'shared', role: 'owner' });
  assert.equal(await findFinanceSpace(client, 'outsider'), null);
});

test('invitations use the owner and member RPCs and expose permission errors', async () => {
  const calls = [];
  const client = { rpc(name, args) { calls.push({ name, args });
    return Promise.resolve(name === 'create_finance_invite'
      ? { data: 'invite-token', error: null }
      : { data: 'shared', error: null }); } };
  assert.equal(await createFinanceInvite(client, 'shared'), 'invite-token');
  assert.equal(await acceptFinanceInvite(client, 'invite-token'), 'shared');
  assert.deepEqual(calls, [
    { name: 'create_finance_invite', args: { p_space_id: 'shared' } },
    { name: 'accept_finance_invite', args: { p_token: 'invite-token' } },
  ]);
  await assert.rejects(createFinanceInvite({ rpc: async () => ({ data: null, error: { message: 'Solo el dueño puede invitar' } }) }, 'shared'),
    /Solo el dueño/);
});

test('shared rows reconstruct FinanceData and retain all paginated movements', async () => {
  const ledger = Array.from({ length: 501 }, (_, index) => ({ id: `expense-${index}`, space_id: 'shared',
    kind: 'expense', scope: 'everyday', amount: '1.00', currency: 'ARS', account_id: 'ARS-efectivo',
    description: 'Compra', entry_date: '2026-10-23', created_at: `2026-10-23T${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00Z` }));
  const rows = {
    finance_accounts: [{ id: 'ARS-efectivo', currency: 'ARS', method: 'Efectivo', name: 'Efectivo', opening: '1000.00' }],
    finance_entries: ledger,
    finance_categories: [], finance_income_sources: [], finance_funds: [], finance_budgets: [],
    finance_business_openings: [], finance_income_goals: [], finance_income_quotes: [],
    finance_giro_links: [], finance_giro_results: [],
  };
  const orderCalls = [];
  const client = { from(table) { return { select() { return { eq() { return { order(column, options) { orderCalls.push({table,column,ascending:options.ascending}); return this; }, async range(start, end) {
    return { data: rows[table].slice(start, end + 1), error: null };
  } }; } }; } }; } };
  const data = await loadFinanceSpace(client, 'shared');
  assert.equal(data.entries.length, 501);
  assert.equal(accountBalance(data, 'ARS-efectivo'), 499);
  assert.equal(data.entries[0].createdAt, ledger[0].created_at);
  assert.deepEqual(orderCalls.slice(0,3), [
    {table:'finance_entries',column:'entry_date',ascending:false},
    {table:'finance_entries',column:'created_at',ascending:false},
    {table:'finance_entries',column:'id',ascending:false},
  ]);
});

test('simultaneous movement submissions use transactional RPCs with independent request ids', async () => {
  const { client, calls } = clientFixture();
  const before = emptyData();
  const makeEntry = id => ({ id, kind: 'expense', scope: 'everyday', amount: 10, currency: 'ARS',
    accountId: 'ARS-efectivo', description: id, date: '2026-10-23' });
  const first = { ...before, entries: [makeEntry('first')] };
  const second = { ...before, entries: [makeEntry('second')] };
  await Promise.all([
    persistFinanceChange(client, 'shared', before, first),
    persistFinanceChange(client, 'shared', before, second),
  ]);
  const writes = calls.filter(call => call.action === 'rpc' && call.name === 'apply_finance_entry');
  assert.equal(writes.length, 2);
  assert.notEqual(writes[0].args.p_request_id, writes[1].args.p_request_id);
  assert.deepEqual(writes.map(call => call.args.p_entry.id).sort(), ['first', 'second']);
  assert.equal(calls.filter(call => call.table === 'finance_entries' && call.action === 'upsert').length, 0);

  await persistFinanceChange(client, 'shared', before, first);
  const retries = calls.filter(call => call.action === 'rpc' && call.name === 'apply_finance_entry' && call.args.p_entry.id === 'first');
  assert.equal(retries[0].args.p_request_id, retries[1].args.p_request_id);
});

test('existing shared finance data still loads before the giro migration is applied', async () => {
  const client={from(table){return {select(){return {eq(){return {order(){return this},async range(){
    return table.startsWith('finance_giro_')
      ? {data:null,error:{message:`Could not find the table 'public.${table}' in the schema cache`}}
      : {data:[],error:null};
  }}}}}}}};
  const data=await loadFinanceSpace(client,'shared');
  assert.equal(data.giroAccountingReady,false);
  assert.deepEqual(data.giroLinks,[]);
  assert.deepEqual(data.giroResults,[]);
});
