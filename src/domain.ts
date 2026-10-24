export type Currency = 'ARS' | 'USD' | 'USDT' | 'BOB';
export type AccountMethod = 'Efectivo' | 'Transferencia' | 'Billetera';
export type Scope = 'everyday' | 'business' | 'giro';
export type EntryKind = 'expense' | 'income' | 'transfer' | 'reserve' | 'withdraw' | 'allocation' | 'giro';
export type FundKind = 'goal' | 'pasanaco';
export type GoalIcon = 'plane' | 'sun' | 'house' | 'heart' | 'sparkles' | 'target';
export type IncomeView = 'available' | 'business' | 'combined';

export type Account = { id: string; currency: Currency; method: AccountMethod; name: string; opening: number };
export type Category = { id: string; name: string; color: string; icon: string; archived?: boolean };
export type IncomeSource = { id: string; name: string; archived?: boolean };
export type Goal = { id: string; name: string; currency: Currency; target: number; icon: GoalIcon; color: string; targetDate?: string; archived?: boolean };
export type Pasanaco = { id: string; name: string; currency: Currency; amount: number; frequency: 'weekly' | 'biweekly'; startDate: string; sourceAccountId: string; target?: number };
export type Entry = {
  id: string;
  kind: EntryKind;
  scope: Scope;
  amount: number;
  currency: Currency;
  accountId?: string;
  toAccountId?: string;
  received?: number;
  rate?: number;
  giroReference?: string;
  giroProfit?: number;
  giroProfitCurrency?: Currency;
  fundId?: string;
  categoryId?: string;
  incomeSourceId?: string;
  description: string;
  date: string;
  createdAt?: string;
};
export type IncomeGoal = { month: string; currency: Currency; view: IncomeView; previous: number; target: number; growthType: 'percent' | 'fixed'; growth: number; includeConverted?: boolean; rates?: Partial<Record<Currency,number>>; baselineManual?: boolean };
export type IncomeQuote = { id:string; month:string; from:Currency; to:Currency; rate:number; date:string };
export type FinanceData = {
  accounts: Account[];
  entries: Entry[];
  businessOpening: Partial<Record<Currency,number>>;
  categories: Category[];
  incomeSources: IncomeSource[];
  goals: Goal[];
  pasanaco: Pasanaco | null;
  budget: { amount: number; currency: Currency };
  incomeGoal: IncomeGoal | null;
  incomeGoals: IncomeGoal[];
  incomeQuotes: IncomeQuote[];
};

export const CURRENCIES: Currency[] = ['ARS', 'BOB', 'USD', 'USDT'];
export const CURRENCY_NAMES: Record<Currency,string> = { ARS: 'Pesos argentinos', USD: 'Dólares', USDT: 'Tether', BOB: 'Bolivianos' };
export const currencyScale = (currency:Currency) => currency==='USDT'?1_000_000:100;
export const roundMoney = (amount:number,currency:Currency) => Math.sign(amount)*Math.round((Math.abs(amount)+Number.EPSILON*Math.max(1,Math.abs(amount)))*currencyScale(currency))/currencyScale(currency);
export const formatMoney = (amount: number, currency: Currency) => {
  const prefix = amount < 0 ? '−' : '';
  const symbol = currency === 'USD' ? 'US$' : currency === 'BOB' ? 'Bs ' : currency === 'USDT' ? '' : '$';
  const digits = currency === 'USDT' ? 6 : 2;
  const absolute=Math.abs(roundMoney(amount,currency));
  return `${prefix}${symbol}${absolute.toLocaleString('es-AR', { minimumFractionDigits:absolute%1?digits:0,maximumFractionDigits:digits })}${currency === 'USDT' ? ' USDT' : ''}`;
};
export const pct = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 100) : 0;
export const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
export const shiftMonth = (date: Date, offset: number) => new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
export const dateISO = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const monthLabel = (date: Date) => new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(date);
export const inMonth = (entry: Entry, month: string) => entry.date.slice(0, 7) === month;
export const toggleCategorySelection=(selected:string|null,id:string)=>selected===id?null:id;
export function paginate<T>(items:T[],page:number,pageSize:10|20|50){
  const pages=Math.max(1,Math.ceil(items.length/pageSize));
  const currentPage=Math.min(Math.max(1,page),pages);
  return {pages,currentPage,visible:items.slice((currentPage-1)*pageSize,currentPage*pageSize)};
}

export function accountBalance(data: FinanceData, accountId: string): number {
  const account = data.accounts.find(a => a.id === accountId);
  if (!account) return 0;
  const scale=currencyScale(account.currency);
  const units=(amount:number)=>Math.round(roundMoney(amount,account.currency)*scale);
  const balance=data.entries.reduce((balance, entry) => {
    if (entry.kind === 'income' && entry.accountId === accountId) return balance + units(entry.amount);
    if (entry.kind === 'expense' && entry.accountId === accountId) return balance - units(entry.amount);
    if (entry.kind === 'reserve' && entry.accountId === accountId) return balance - units(entry.amount);
    if (entry.kind === 'withdraw' && entry.accountId === accountId) return balance + units(entry.amount);
    if (entry.kind === 'transfer' || entry.kind === 'giro') {
      if (entry.accountId === accountId) balance -= units(entry.amount);
      if (entry.toAccountId === accountId) balance += units(entry.received ?? entry.amount);
    }
    return balance;
  }, units(account.opening));
  return balance/scale;
}

export function currencyBalance(data: FinanceData, currency: Currency): number {
  return data.accounts.filter(a => a.currency === currency).reduce((sum, a) => sum + accountBalance(data, a.id), 0);
}

export function reservedBalance(data: FinanceData, fundId: string): number {
  return data.entries.filter(e => e.fundId === fundId).reduce((sum, e) => sum + (e.kind === 'reserve' ? e.amount : e.kind === 'withdraw' ? -e.amount : 0), 0);
}

export function everydayExpenses(data: FinanceData, currency: Currency, month: string): Entry[] {
  return data.entries.filter(e => e.kind === 'expense' && e.scope === 'everyday' && e.currency === currency && inMonth(e, month));
}

export function businessEntries(data: FinanceData, currency: Currency, month: string): Entry[] {
  return data.entries.filter(e => e.scope === 'business' && e.currency === currency && inMonth(e, month) && (e.kind === 'expense' || e.kind === 'income' || e.kind === 'reserve' || e.kind === 'withdraw'));
}

export function incomeAmount(data: FinanceData, currency: Currency, month: string, view: IncomeView): number {
  const ordinary=data.entries.filter(e => e.currency === currency && inMonth(e, month) && e.kind === 'income' && (view === 'combined' || (view === 'business' ? e.scope === 'business' : e.scope === 'everyday'))).reduce((sum, e) => sum + e.amount, 0);
  const giroGain=view==='business'?0:data.entries.filter(e=>e.kind==='giro'&&inMonth(e,month)&&(e.giroProfitCurrency||data.accounts.find(a=>a.id===e.toAccountId)?.currency)===currency).reduce((sum,e)=>sum+(e.giroProfit||0),0);
  return roundMoney(ordinary+giroGain,currency);
}

export function businessBalance(data:FinanceData,currency:Currency):number|null {
  const opening=data.businessOpening?.[currency];
  if(opening===undefined)return null;
  return roundMoney(opening+data.entries.filter(e=>e.scope==='business'&&e.currency===currency).reduce((sum,e)=>sum+(e.kind==='income'||e.kind==='withdraw'?e.amount:e.kind==='expense'||e.kind==='reserve'?-e.amount:0),0),currency);
}

export function consolidatedIncome(data:FinanceData,month:string,reference:Currency,view:IncomeView,convert=true):{total:number;missing:Currency[]} {
  const missing:Currency[]=[];
  const total=CURRENCIES.reduce((sum,c)=>{
    const amount=incomeAmount(data,c,month,view);
    if(c===reference)return sum+amount;
    if(!convert||!amount)return sum;
    const rate=(data.incomeQuotes||[]).find(q=>q.month===month&&q.from===c&&q.to===reference)?.rate;
    if(!rate){missing.push(c);return sum}
    return sum+amount*rate;
  },0);
  return {total,missing};
}

export function incomeGoalAmount(data:FinanceData, month:string, goal:IncomeGoal):number {
  if(!goal.includeConverted)return incomeAmount(data,goal.currency,month,goal.view);
  const result=consolidatedIncome(data,month,goal.currency,goal.view,true);
  if(goal.month===month&&result.missing.length)return result.total+result.missing.reduce((sum,c)=>sum+incomeAmount(data,c,month,goal.view)*(goal.rates?.[c]||0),0);
  return result.total;
}

export function movementImpact(entry: Entry, accountId: string): number {
  if (entry.kind === 'income' && entry.accountId === accountId) return entry.amount;
  if ((entry.kind === 'expense' || entry.kind === 'reserve') && entry.accountId === accountId) return -entry.amount;
  if (entry.kind === 'withdraw' && entry.accountId === accountId) return entry.amount;
  if (entry.kind === 'transfer' || entry.kind === 'giro') return (entry.toAccountId === accountId ? entry.received ?? entry.amount : 0) - (entry.accountId === accountId ? entry.amount : 0);
  return 0;
}

export function canApplyEntry(data: FinanceData, entry: Entry): string | null {
  if(entry.kind==='allocation')return 'Las asignaciones internas ya no están disponibles.';
  if (!Number.isFinite(entry.amount) || entry.amount <= 0) return 'Ingresá un monto mayor que cero.';
  if (Math.abs(entry.amount-roundMoney(entry.amount,entry.currency))>1e-9) return `El monto tiene demasiados decimales para ${entry.currency}.`;
  if (entry.kind === 'transfer' || entry.kind === 'giro') {
    const from = data.accounts.find(a => a.id === entry.accountId);
    const to = data.accounts.find(a => a.id === entry.toAccountId);
    if (!from || !to || (entry.kind==='transfer'&&from.id === to.id)) return 'Elegí dos cuentas distintas.';
    if (from.currency !== entry.currency) return 'La moneda de origen no coincide con la cuenta.';
    if (!Number.isFinite(entry.received) || !entry.received || entry.received <= 0) return 'Ingresá cuánto dinero recibiste.';
    if (Math.abs(entry.received-roundMoney(entry.received,to.currency))>1e-9) return `El importe recibido tiene demasiados decimales para ${to.currency}.`;
    if (entry.kind==='transfer'&&from.currency===to.currency && Math.abs(entry.received-entry.amount)>0.000001) return 'Entre cuentas de la misma moneda, el importe recibido debe ser igual al entregado.';
    if (entry.kind==='giro') {
      if (entry.scope!=='giro') return 'Clasificá la operación como giro.';
      if (entry.giroProfit!==undefined && (!Number.isFinite(entry.giroProfit)||entry.giroProfit<0||((entry.giroProfitCurrency||to.currency)===to.currency&&entry.giroProfit>entry.received))) return 'La ganancia debe estar dentro del total cobrado cuando usa la misma moneda.';
      if(entry.giroProfit!==undefined&&Math.abs(entry.giroProfit-roundMoney(entry.giroProfit,entry.giroProfitCurrency||to.currency))>1e-9)return 'La ganancia tiene demasiados decimales para su moneda.';
    }
  } else {
    const account = data.accounts.find(a => a.id === entry.accountId);
    if (!account || account.currency !== entry.currency) return 'Elegí una cuenta de la moneda del movimiento.';
  }
  if (entry.kind === 'reserve' || entry.kind === 'withdraw') {
    const fund = data.goals.find(g => g.id === entry.fundId) || (data.pasanaco?.id === entry.fundId ? data.pasanaco : null);
    if (!fund || fund.currency !== entry.currency) return 'Elegí un fondo de la misma moneda.';
  }
  if (entry.kind === 'withdraw' && (!entry.fundId || reservedBalance(data, entry.fundId) < entry.amount)) return 'El fondo no tiene suficiente dinero reservado.';
  if (entry.kind === 'expense' || entry.kind === 'reserve' || entry.kind === 'transfer' || entry.kind === 'giro') {
    if (accountBalance(data, entry.accountId!) < entry.amount) return 'La cuenta de origen no tiene saldo suficiente.';
  }
  return null;
}
