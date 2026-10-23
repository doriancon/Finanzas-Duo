import type { Account, Category, Currency, Entry, FinanceData, IncomeSource } from './domain.ts';
import { dateISO, monthKey } from './domain.ts';

const now = new Date();
const day = (n: number, offset = 0) => dateISO(new Date(now.getFullYear(), now.getMonth() + offset, n, 12));
const currentMonth = monthKey(now);
const account = (currency: Currency, method: Account['method'], opening = 0): Account => ({ id: `${currency}-${method.toLowerCase()}`, currency, method, name: method, opening });

export const defaultAccounts: Account[] = [
  account('ARS','Efectivo'), account('ARS','Transferencia'),
  account('BOB','Efectivo'), account('BOB','Transferencia'),
  account('USD','Efectivo'), account('USDT','Billetera'),
];

export const defaultCategories: Category[] = [
  { id:'gasolina',name:'Gasolina',color:'#8c5cf6',icon:'fuel' },
  { id:'alimentacion',name:'Alimentación',color:'#ffad72',icon:'food' },
  { id:'compras',name:'Compras',color:'#82c9e9',icon:'shopping' },
  { id:'otros',name:'Otros',color:'#eadc8e',icon:'layers' },
  { id:'vivienda',name:'Vivienda',color:'#b1a5f4',icon:'house' },
  { id:'transporte',name:'Transporte',color:'#9edfc2',icon:'car' },
  { id:'servicios',name:'Servicios',color:'#f4a6bd',icon:'bolt' },
  { id:'entretenimiento',name:'Entretenimiento',color:'#83b6fb',icon:'sparkles' },
  { id:'salud',name:'Salud',color:'#b7d5a4',icon:'heart' },
  { id:'materiales',name:'Materiales',color:'#e6a3c8',icon:'shopping' },
  { id:'confeccion',name:'Confección',color:'#c79ae8',icon:'sparkles' },
  { id:'operativos',name:'Operativos',color:'#ecc486',icon:'layers' },
  { id:'telas',name:'Telas',color:'#d58bd1',icon:'shopping' },
  { id:'insumos',name:'Insumos',color:'#9a86e9',icon:'layers' },
  { id:'empaques',name:'Empaques',color:'#d8b57c',icon:'layers' },
  { id:'elasticos',name:'Elásticos',color:'#86bfca',icon:'layers' },
];

export const defaultIncomeSources: IncomeSource[] = [
  {id:'sueldo',name:'Sueldo fijo'}, {id:'emprendimiento',name:'Emprendimiento'},
  {id:'independiente',name:'Trabajo independiente'}, {id:'adicional',name:'Ingreso adicional'}, {id:'otro',name:'Otro'},
];

export const emptyData = (): FinanceData => ({
  accounts: defaultAccounts.map(a => ({...a})), entries: [], businessOpening:{},
  categories: defaultCategories.map(c => ({...c})),
  incomeSources: defaultIncomeSources.map(s => ({...s})),
  goals: [], pasanaco: null, budget: {amount:0,currency:'ARS'}, incomeGoal: null, incomeGoals:[], incomeQuotes:[],
});

const demoEntry = (id: string, kind: Entry['kind'], scope: Entry['scope'], amount: number, currency: Currency, accountId: string, categoryId: string | undefined, incomeSourceId: string | undefined, description: string, date: string, fundId?: string): Entry => ({id,kind,scope,amount,currency,accountId,categoryId,incomeSourceId,description,date,fundId});

export const demoData = (): FinanceData => {
  const data = emptyData();
  data.accounts = data.accounts.map(a => a.id === 'ARS-efectivo' ? {...a,opening:250000} : a.id === 'ARS-transferencia' ? {...a,opening:271000} : a.id === 'BOB-efectivo' ? {...a,opening:2100} : a.id === 'BOB-transferencia' ? {...a,opening:4400} : a.id === 'USDT-billetera' ? {...a,opening:480} : a);
  data.budget = {amount:300000,currency:'ARS'};
  data.incomeGoal = {month:currentMonth,currency:'USD',view:'available',previous:1000,target:1100,growthType:'percent',growth:10,includeConverted:true};
  data.incomeGoals=[{month:monthKey(new Date(now.getFullYear(),now.getMonth()-1,1)),currency:'USD',view:'available',previous:900,target:950,growthType:'percent',growth:5,includeConverted:false},data.incomeGoal];
  data.incomeQuotes=[{id:'demo-quote',month:currentMonth,from:'ARS',to:'USD',rate:0.0007,date:day(1)}];
  data.pasanaco = {id:'demo-pasanaco',name:'Pasanaco',currency:'ARS',amount:50000,frequency:'weekly',startDate:day(1,-1),sourceAccountId:'ARS-transferencia'};
  data.entries = [
    demoEntry('d1','expense','everyday',38000,'ARS','ARS-transferencia','gasolina',undefined,'Carga de combustible',day(now.getDate())),
    demoEntry('d2','expense','everyday',57000,'ARS','ARS-efectivo','gasolina',undefined,'Combustible del mes',day(8)),
    demoEntry('d3','expense','everyday',80000,'ARS','ARS-transferencia','alimentacion',undefined,'Compras del supermercado',day(11)),
    demoEntry('d4','expense','everyday',25000,'ARS','ARS-transferencia','compras',undefined,'Artículos para casa',day(5)),
    demoEntry('d5','expense','everyday',15000,'ARS','ARS-efectivo','otros',undefined,'Café y salidas',day(3)),
    demoEntry('d6','expense','business',800000,'ARS','ARS-transferencia','materiales',undefined,'Telas para lencería',day(9)),
    demoEntry('d7','income','business',1250000,'ARS','ARS-transferencia',undefined,'emprendimiento','Ventas de la semana',day(12)),
    demoEntry('d8','income','everyday',430000,'ARS','ARS-transferencia',undefined,'independiente','Ingreso de Dorian',day(2)),
    demoEntry('d9','expense','everyday',76000,'ARS','ARS-efectivo','gasolina',undefined,'Combustible',day(7,-1)),
    demoEntry('d10','expense','everyday',92000,'ARS','ARS-transferencia','alimentacion',undefined,'Supermercado',day(10,-1)),
    demoEntry('d11','expense','everyday',49000,'ARS','ARS-transferencia','compras',undefined,'Compras',day(15,-1)),
    demoEntry('d12','expense','everyday',19000,'ARS','ARS-efectivo','otros',undefined,'Varios',day(18,-1)),
    demoEntry('d13','income','everyday',720,'USD','USD-efectivo',undefined,'sueldo','Sueldo de Dani',day(6)),
    demoEntry('d14','income','everyday',1000,'USD','USD-efectivo',undefined,'sueldo','Sueldo del mes anterior',day(6,-1)),
    demoEntry('d17','allocation','business',100000,'ARS','ARS-transferencia',undefined,undefined,'Asignado a la pareja desde Lencería',day(13)),
    demoEntry('d15','reserve','everyday',50000,'ARS','ARS-transferencia',undefined,undefined,'Aporte al Pasanaco',day(3,-1),'demo-pasanaco'),
    demoEntry('d16','reserve','everyday',50000,'ARS','ARS-transferencia',undefined,undefined,'Aporte al Pasanaco',day(10,-1),'demo-pasanaco'),
  ];
  return data;
};

const safeParse = <T,>(key: string): T | null => {try {const raw=localStorage.getItem(key);return raw?JSON.parse(raw) as T:null;}catch{return null;}};

type LegacyEntry = {id:string;kind:'expense'|'income'|'transfer'|'saving';scope:'everyday'|'business';amount:number;currency:Currency;category:string;description:string;date:string;method:string};
type LegacyCategory = {name:string;color:string};
type LegacyGoal = {id:string;name:string;currency:Currency;target:number;saved:number;color:string};

function importLegacy(data: FinanceData): FinanceData {
  const legacyEntries = safeParse<LegacyEntry[]>('duo-transactions-v2') || [];
  const legacyCategories = safeParse<LegacyCategory[]>('duo-categories') || [];
  const legacyGoals = safeParse<LegacyGoal[]>('duo-goals') || [];
  const customCategories = legacyCategories.filter(c => !data.categories.some(existing => existing.name.toLowerCase() === c.name.toLowerCase()));
  data.categories.push(...customCategories.map((c,i) => ({id:`legacy-category-${i}`,name:c.name,color:c.color,icon:'layers'})));
  const customGoals = legacyGoals.filter(g => !/^g\d+$/.test(g.id));
  data.goals.push(...customGoals.map(g => ({id:g.id,name:g.name,currency:g.currency,target:g.target,color:g.color,icon:'sparkles' as const})));
  const customEntries = legacyEntries.filter(e => !/^d\d+$/.test(e.id));
  for (const e of customEntries) {
    const method = e.method === 'Efectivo' ? 'Efectivo' : e.method === 'Billetera' ? 'Billetera' : 'Transferencia';
    const account = data.accounts.find(a => a.currency === e.currency && a.method === method) || data.accounts.find(a => a.currency === e.currency);
    if (!account) continue;
    const category = data.categories.find(c => c.name === e.category);
    const goal=e.kind==='saving'?customGoals.find(g=>e.description.toLowerCase().includes(g.name.toLowerCase())&&g.currency===e.currency):undefined;
    if(e.kind==='saving'&&!goal)continue;
    // El formato anterior no guardaba una cuenta de destino. Un traspaso histórico se
    // conserva visible con impacto neto cero en su cuenta, como ocurría antes.
    data.entries.push({id:e.id,kind:e.kind === 'saving' ? 'reserve' : e.kind,scope:e.scope,amount:e.amount,currency:e.currency,accountId:account.id,toAccountId:e.kind==='transfer'?account.id:undefined,received:e.kind==='transfer'?e.amount:undefined,fundId:goal?.id,categoryId:category?.id,incomeSourceId:e.kind === 'income' ? e.scope === 'business' ? 'emprendimiento' : 'otro' : undefined,description:e.description,date:e.date});
  }
  return data;
}

const removeOldGiroOptions=(entry:Entry):Entry=>{const clean={...entry} as Entry&{giroCost?:number;giroProfitAsIncome?:boolean};delete clean.giroCost;delete clean.giroProfitAsIncome;return clean};
export const loadData = (): FinanceData => {
  const current=safeParse<FinanceData>('duo-v4-data');
  const personal=safeParse<FinanceData>('duo-v3-data-personal');
  const saved=current||personal;
  const personalIsEmpty=!!personal&&personal.entries.length===0&&personal.accounts.every(a=>!a.opening)&&personal.goals.length===0&&!personal.pasanaco&&!personal.budget.amount;
  const oldDemo=!current&&(!personal||personalIsEmpty)?safeParse<FinanceData>('duo-v3-data-demo'):null;
  const data=saved||importLegacy(emptyData());
  if(oldDemo){
    const fixture=demoData();
    data.entries=oldDemo.entries.filter(e=>{const sample=fixture.entries.find(d=>d.id===e.id);return !sample||e.kind!==sample.kind||e.scope!==sample.scope||e.amount!==sample.amount||e.currency!==sample.currency||e.accountId!==sample.accountId||e.description!==sample.description});
    data.accounts=data.accounts.map(a=>{const old=oldDemo.accounts.find(x=>x.id===a.id);const example=fixture.accounts.find(x=>x.id===a.id);return old&&old.opening!==example?.opening?{...a,opening:old.opening}:a});
    data.categories=oldDemo.categories||data.categories;
    data.incomeSources=oldDemo.incomeSources||data.incomeSources;
    data.goals=(oldDemo.goals||[]).filter(g=>!g.id.startsWith('demo-'));
    data.pasanaco=oldDemo.pasanaco?.id.startsWith('demo-')?null:oldDemo.pasanaco;
    data.budget=oldDemo.budget?.amount!==fixture.budget.amount?oldDemo.budget:data.budget;
  }
  data.incomeGoals||=data.incomeGoal?[data.incomeGoal]:[];
  data.incomeQuotes||=[];
  data.businessOpening||={};
  for(const category of defaultCategories)if(!data.categories.some(c=>c.id===category.id))data.categories.push({...category});
  data.entries=data.entries.filter(e=>e.kind!=='allocation').map(removeOldGiroOptions);
  delete (data as FinanceData&{deletedEntries?:Entry[]}).deletedEntries;
  return normalizeAccounts(data);
};
export const saveData = (data: FinanceData) => localStorage.setItem('duo-v4-data',JSON.stringify(data));

export function normalizeAccounts(data:FinanceData):FinanceData {
  const aliases=new Map<string,string>();
  const normalized=defaultAccounts.map(base=>({...base,opening:0}));
  for(const old of data.accounts){
    const targetCurrency=old.currency;
    const targetMethod=targetCurrency==='USD'?'Efectivo':targetCurrency==='USDT'?'Billetera':old.method==='Billetera'?'Transferencia':old.method;
    const canonical=normalized.find(a=>a.currency===targetCurrency&&a.method===targetMethod);
    if(canonical){if(old.id!==canonical.id)aliases.set(old.id,canonical.id);canonical.opening+=old.opening}
  }
  data.accounts=normalized;
  data.entries=data.entries.map(e=>({...e,accountId:e.accountId?aliases.get(e.accountId)||e.accountId:undefined,toAccountId:e.toAccountId?aliases.get(e.toAccountId)||e.toAccountId:undefined}));
  if(data.pasanaco)data.pasanaco={...data.pasanaco,sourceAccountId:aliases.get(data.pasanaco.sourceAccountId)||data.pasanaco.sourceAccountId};
  return data;
}
