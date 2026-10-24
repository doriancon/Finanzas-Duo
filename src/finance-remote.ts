import type { SupabaseClient } from '@supabase/supabase-js';
import type { Account, Category, Currency, Entry, FinanceData, Goal, IncomeGoal, IncomeQuote, IncomeSource, Pasanaco } from './domain.ts';
import { emptyData } from './data.ts';

type Row = Record<string, any>;
type Table = 'finance_accounts' | 'finance_categories' | 'finance_income_sources' | 'finance_funds' |
  'finance_budgets' | 'finance_business_openings' | 'finance_income_goals' | 'finance_income_quotes' | 'finance_entries';

const tables: Table[] = ['finance_accounts', 'finance_categories', 'finance_income_sources', 'finance_funds',
  'finance_budgets', 'finance_business_openings', 'finance_income_goals', 'finance_income_quotes', 'finance_entries'];
const number = (value: unknown) => Number(value ?? 0);
const checked = ({ error }: { error: { message: string } | null }) => { if (error) throw new Error(error.message); };
const requestIds = new Map<string, string>();
const requestIdFor = (spaceId: string, operation: string, entry: Entry) => {
  const key = JSON.stringify([spaceId, operation, entry]);
  const previous = requestIds.get(key);
  if (previous) return previous;
  const id = crypto.randomUUID();
  requestIds.set(key, id);
  return id;
};

export async function findFinanceSpace(client: SupabaseClient, userId: string): Promise<{ id: string; role: 'owner' | 'member' } | null> {
  const { data, error } = await client.from('finance_space_members').select('space_id,role').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: data.space_id, role: data.role } : null;
}

export async function createFinanceInvite(client: SupabaseClient, spaceId: string): Promise<string> {
  const { data, error } = await client.rpc('create_finance_invite', { p_space_id: spaceId });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function acceptFinanceInvite(client: SupabaseClient, token: string): Promise<string> {
  const { data, error } = await client.rpc('accept_finance_invite', { p_token: token });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function loadFinanceSpace(client: SupabaseClient, spaceId: string): Promise<FinanceData> {
  const fetchAll = async (table: Table): Promise<Row[]> => {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += 500) {
      const result = await client.from(table).select('*').eq('space_id', spaceId).range(offset, offset + 499);
      checked(result);
      const page = (result.data || []) as Row[];
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  };
  const [accounts, categories, sources, funds, budgets, openings, goals, quotes, entries] = await Promise.all(tables.map(fetchAll));
  const data = emptyData();
  data.accounts = accounts.map(a => ({ id: a.id, currency: a.currency, method: a.method, name: a.name, opening: number(a.opening) } as Account));
  data.categories = categories.map(c => ({ id: c.id, name: c.name, color: c.color, icon: c.icon, archived: c.archived } as Category));
  data.incomeSources = sources.map(s => ({ id: s.id, name: s.name, archived: s.archived } as IncomeSource));
  data.goals = funds.filter(f => f.kind === 'goal').map(f => ({ id: f.id, name: f.name, currency: f.currency,
    target: number(f.target), targetDate: f.target_date || undefined, icon: f.icon, color: f.color, archived: f.archived } as Goal));
  const pasanaco = funds.find(f => f.kind === 'pasanaco');
  data.pasanaco = pasanaco ? { id: pasanaco.id, name: pasanaco.name, currency: pasanaco.currency,
    amount: number(pasanaco.amount), frequency: pasanaco.frequency, startDate: pasanaco.start_date,
    sourceAccountId: pasanaco.source_account_id, target: pasanaco.target == null ? undefined : number(pasanaco.target) } as Pasanaco : null;
  data.budget = budgets[0] ? { amount: number(budgets[0].amount), currency: budgets[0].currency } : data.budget;
  data.businessOpening = Object.fromEntries(openings.map(o => [o.currency, number(o.amount)])) as Partial<Record<Currency, number>>;
  data.incomeGoals = goals.map(g => ({ month: g.month, currency: g.currency, view: g.view, previous: number(g.previous),
    target: number(g.target), growthType: g.growth_type, growth: number(g.growth), includeConverted: g.include_converted,
    rates: g.rates, baselineManual: g.baseline_manual } as IncomeGoal));
  data.incomeGoal = [...data.incomeGoals].sort((a, b) => b.month.localeCompare(a.month))[0] || null;
  data.incomeQuotes = quotes.map(q => ({ id: q.id, month: q.month, from: q.from_currency, to: q.to_currency,
    rate: number(q.rate), date: q.quote_date } as IncomeQuote));
  data.entries = entries.map(e => ({ id: e.id, kind: e.kind, scope: e.scope, amount: number(e.amount),
    currency: e.currency, accountId: e.account_id, toAccountId: e.to_account_id || undefined,
    received: e.received == null ? undefined : number(e.received), rate: e.rate == null ? undefined : number(e.rate),
    giroReference: e.giro_reference || undefined, giroProfit: e.giro_profit == null ? undefined : number(e.giro_profit),
    giroProfitCurrency: e.giro_profit_currency || undefined, fundId: e.fund_id || undefined,
    categoryId: e.category_id || undefined, incomeSourceId: e.income_source_id || undefined,
    description: e.description, date: e.entry_date } as Entry));
  return data;
}

function differences<T extends { id: string }>(before: T[], after: T[]) {
  const previous = new Map(before.map(item => [item.id, item]));
  const current = new Set(after.map(item => item.id));
  return { changed: after.filter(item => JSON.stringify(previous.get(item.id)) !== JSON.stringify(item)),
    removed: before.filter(item => !current.has(item.id)) };
}

async function upsert(client: SupabaseClient, table: Table, rows: Row[], conflict = 'space_id,id') {
  if (rows.length) checked(await client.from(table).upsert(rows, { onConflict: conflict }));
}
async function remove(client: SupabaseClient, table: Table, spaceId: string, id: string) {
  checked(await client.from(table).delete().eq('space_id', spaceId).eq('id', id));
}

// Solo envía los campos cambiados. Los movimientos y saldos iniciales usan RPCs con
// candado por espacio, validación de saldo e idempotencia; nunca escrituras directas.
export async function persistFinanceChange(client: SupabaseClient, spaceId: string, before: FinanceData, after: FinanceData): Promise<void> {
  const categories = differences(before.categories, after.categories);
  const sources = differences(before.incomeSources, after.incomeSources);
  const funds = differences([...before.goals, ...(before.pasanaco ? [before.pasanaco] : [])],
    [...after.goals, ...(after.pasanaco ? [after.pasanaco] : [])]);
  const quotes = differences(before.incomeQuotes, after.incomeQuotes);
  const entries = differences(before.entries, after.entries);

  await upsert(client, 'finance_categories', categories.changed.map(c => ({ space_id: spaceId, ...c })));
  await upsert(client, 'finance_income_sources', sources.changed.map(s => ({ space_id: spaceId, ...s })));
  await upsert(client, 'finance_funds', funds.changed.map(f => f.id === after.pasanaco?.id
    ? { space_id: spaceId, id: f.id, kind: 'pasanaco', name: f.name, currency: f.currency,
        amount: (f as Pasanaco).amount, frequency: (f as Pasanaco).frequency, start_date: (f as Pasanaco).startDate,
        source_account_id: (f as Pasanaco).sourceAccountId, target: (f as Pasanaco).target ?? null }
    : { space_id: spaceId, id: f.id, kind: 'goal', name: f.name, currency: f.currency,
        target: (f as Goal).target, target_date: (f as Goal).targetDate || null,
        icon: (f as Goal).icon, color: (f as Goal).color, archived: (f as Goal).archived ?? false }));

  for (const account of after.accounts) {
    if (account.opening !== before.accounts.find(a => a.id === account.id)?.opening) {
      checked(await client.rpc('set_finance_account_opening', { p_space_id: spaceId, p_account_id: account.id, p_opening: account.opening }));
    }
  }
  for (const entry of entries.changed) {
    const mode = before.entries.some(e => e.id === entry.id) ? 'update' : 'create';
    checked(await client.rpc('apply_finance_entry', { p_space_id: spaceId,
      p_mode: mode, p_entry: entry, p_request_id: requestIdFor(spaceId, mode, entry) }));
  }
  for (const entry of entries.removed) {
    checked(await client.rpc('delete_finance_entry', { p_space_id: spaceId, p_entry_id: entry.id,
      p_request_id: requestIdFor(spaceId, 'delete', entry) }));
  }
  for (const item of funds.removed) await remove(client, 'finance_funds', spaceId, item.id);
  for (const item of categories.removed) await remove(client, 'finance_categories', spaceId, item.id);
  for (const item of sources.removed) await remove(client, 'finance_income_sources', spaceId, item.id);

  if (JSON.stringify(before.budget) !== JSON.stringify(after.budget))
    await upsert(client, 'finance_budgets', [{ space_id: spaceId, ...after.budget }], 'space_id');
  for (const currency of ['ARS', 'BOB', 'USD', 'USDT'] as const) {
    const oldValue = before.businessOpening[currency];
    const newValue = after.businessOpening[currency];
    if (oldValue === newValue) continue;
    if (newValue === undefined) checked(await client.from('finance_business_openings').delete().eq('space_id', spaceId).eq('currency', currency));
    else await upsert(client, 'finance_business_openings', [{ space_id: spaceId, currency, amount: newValue }], 'space_id,currency');
  }
  for (const goal of after.incomeGoals) {
    if (JSON.stringify(before.incomeGoals.find(g => g.month === goal.month)) !== JSON.stringify(goal))
      await upsert(client, 'finance_income_goals', [{ space_id: spaceId, month: goal.month, currency: goal.currency,
        view: goal.view, previous: goal.previous, target: goal.target, growth_type: goal.growthType, growth: goal.growth,
        include_converted: goal.includeConverted ?? false, rates: goal.rates ?? {}, baseline_manual: goal.baselineManual ?? false }], 'space_id,month');
  }
  for (const quote of quotes.changed) await upsert(client, 'finance_income_quotes', [{ space_id: spaceId, id: quote.id,
    month: quote.month, from_currency: quote.from, to_currency: quote.to, rate: quote.rate, quote_date: quote.date }],
    'space_id,month,from_currency,to_currency');
  for (const quote of quotes.removed) await remove(client, 'finance_income_quotes', spaceId, quote.id);
}
