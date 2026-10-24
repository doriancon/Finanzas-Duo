import test from 'node:test';
import assert from 'node:assert/strict';
import { accountBalance, businessBalance, canApplyEntry, consolidatedIncome, currencyBalance, everydayExpenses, formatMoney, incomeAmount, incomeGoalAmount, paginate, reservedBalance, roundMoney, toggleCategorySelection } from '../src/domain.ts';
import { demoData, loadData, normalizeAccounts, saveData } from '../src/data.ts';

const month='2026-10';
const base=()=>({
  accounts:[
    {id:'ars-transfer',currency:'ARS',method:'Transferencia',name:'Transferencia',opening:1_000_000},
    {id:'ars-cash',currency:'ARS',method:'Efectivo',name:'Efectivo',opening:0},
    {id:'usd-transfer',currency:'USD',method:'Transferencia',name:'Transferencia',opening:0},
  ],
  entries:[], businessOpening:{}, categories:[], incomeSources:[], goals:[], pasanaco:null,
  budget:{amount:300_000,currency:'ARS'},incomeGoal:null,incomeGoals:[],incomeQuotes:[],
});
const entry=(id,kind,amount,scope='everyday',more={})=>({id,kind,scope,amount,currency:'ARS',accountId:'ars-transfer',description:id,date:'2026-10-10',...more});

test('one shared account includes business sales, business costs, and household spending',()=>{
  const data=base();
  data.entries=[
    entry('sale','income',500_000,'business'),
    entry('fabric','expense',300_000,'business'),
    entry('sewing','expense',100_000,'business'),
    entry('supermarket','expense',40_000),
  ];
  assert.equal(accountBalance(data,'ars-transfer'),1_060_000);
  assert.equal(currencyBalance(data,'ARS'),1_060_000);
  assert.equal(everydayExpenses(data,'ARS',month).reduce((sum,e)=>sum+e.amount,0),40_000);
  assert.equal(incomeAmount(data,'ARS',month,'business'),500_000);
  assert.equal(incomeAmount(data,'ARS',month,'available'),0);
});

test('own-account transfer, currency exchange, and reserve do not inflate income or expenses',()=>{
  const data=base();
  data.entries=[
    entry('move','transfer',100_000,'everyday',{toAccountId:'ars-cash',received:100_000}),
    entry('fx','transfer',100_000,'everyday',{toAccountId:'usd-transfer',received:100,rate:.001}),
    entry('save','reserve',50_000,'everyday',{fundId:'pasanaco'}),
  ];
  assert.equal(accountBalance(data,'ars-transfer'),750_000);
  assert.equal(accountBalance(data,'ars-cash'),100_000);
  assert.equal(accountBalance(data,'usd-transfer'),100);
  assert.equal(reservedBalance(data,'pasanaco'),50_000);
  assert.equal(everydayExpenses(data,'ARS',month).length,0);
  assert.equal(incomeAmount(data,'ARS',month,'combined'),0);
  assert.equal(canApplyEntry(data,entry('overspend','expense',800_000)), 'La cuenta de origen no tiene saldo suficiente.');
});

test('income goal converts only with an explicit reference rate',()=>{
  const data=base();
  data.entries=[entry('salary','income',430_000),entry('usd-income','income',100,'everyday',{currency:'USD',accountId:'usd-transfer'}),entry('sale','income',500_000,'business')];
  const goal={month,view:'available',currency:'ARS',previous:0,target:0,growthType:'percent',growth:10};
  assert.equal(incomeGoalAmount(data,month,goal),430_000);
  assert.equal(incomeGoalAmount(data,month,{...goal,includeConverted:true,rates:{USD:1200}}),550_000);
  assert.equal(incomeGoalAmount(data,month,{...goal,includeConverted:true,rates:{USD:1200},view:'business'}),550_000);
  assert.equal(incomeGoalAmount(data,month,{...goal,includeConverted:true,rates:{USD:1200},view:'combined'}),550_000);
});

test('manual cross-currency transfer uses exactly the two entered amounts',()=>{
  const data=base();data.accounts[2].id='USD-efectivo';data.accounts[2].method='Efectivo';data.accounts[2].opening=1000;data.accounts[0].opening=0;
  const move=entry('manual','transfer',800,'everyday',{currency:'USD',accountId:'USD-efectivo',toAccountId:'ars-cash',received:120_000});
  assert.equal(canApplyEntry(data,move),null);
  data.entries.push(move);
  assert.equal(accountBalance(data,'USD-efectivo'),200);
  assert.equal(accountBalance(data,'ars-cash'),120_000);
  assert.equal(incomeAmount(data,'ARS',month,'combined'),0);
  assert.equal(everydayExpenses(data,'ARS',month).length,0);
  assert.equal(canApplyEntry(data,entry('wrong','transfer',100,'everyday',{toAccountId:'ars-cash',received:90})),'Entre cuentas de la misma moneda, el importe recibido debe ser igual al entregado.');
  assert.equal(canApplyEntry(data,entry('same','transfer',100,'everyday',{toAccountId:'ars-transfer',received:100})),'Elegí dos cuentas distintas.');
  assert.equal(canApplyEntry(data,entry('poor','transfer',300,'everyday',{currency:'USD',accountId:'USD-efectivo',toAccountId:'ars-cash',received:40_000})),'La cuenta de origen no tiene saldo suficiente.');
});

test('account migration merges old USD transfer into physical USD without losing balance',()=>{
  const data=base();data.accounts[2].opening=300;data.entries=[entry('old','income',50,'everyday',{currency:'USD',accountId:'usd-transfer'})];
  normalizeAccounts(data);
  assert.equal(data.accounts.filter(a=>a.currency==='USD').length,1);
  assert.equal(data.accounts.find(a=>a.currency==='USD').id,'USD-efectivo');
  assert.equal(accountBalance(data,'USD-efectivo'),350);
  assert.equal(data.accounts.some(a=>a.currency==='USDT'&&a.method==='Efectivo'),false);
});

test('business attributed balance uses a configured opening without a separate account',()=>{
  const data=base();data.entries=[entry('sale','income',500_000,'business'),entry('fabric','expense',300_000,'business')];
  assert.equal(businessBalance(data,'ARS'),null);
  data.businessOpening.ARS=100_000;
  assert.equal(businessBalance(data,'ARS'),300_000);
  assert.equal(accountBalance(data,'ars-transfer'),1_200_000);
  assert.equal(incomeAmount(data,'ARS',month,'available'),0);
});

test('saving business money changes its attributed amount without domestic spending',()=>{
  const data=base();data.businessOpening.ARS=200_000;
  data.goals=[{id:'goal',name:'Meta',currency:'ARS',target:100_000,icon:'target',color:'#999'}];
  const saving=entry('saving','reserve',50_000,'business',{fundId:'goal'});
  assert.equal(canApplyEntry(data,saving),null);data.entries.push(saving);
  assert.equal(businessBalance(data,'ARS'),150_000);
  assert.equal(accountBalance(data,'ars-transfer'),950_000);
  assert.equal(reservedBalance(data,'goal'),50_000);
  assert.equal(everydayExpenses(data,'ARS',month).length,0);
});

test('monthly conversion snapshots do not change historical totals',()=>{
  const data=base();data.entries=[entry('sept','income',1_500_000,'everyday',{date:'2026-09-10'}),entry('oct','income',1_500_000)];
  data.incomeQuotes=[{id:'sept',month:'2026-09',from:'ARS',to:'USD',rate:1/1500,date:'2026-09-20'},{id:'oct',month:'2026-10',from:'ARS',to:'USD',rate:1/1200,date:'2026-10-20'}];
  assert.equal(consolidatedIncome(data,'2026-09','USD','available').total,1000);
  assert.equal(consolidatedIncome(data,'2026-10','USD','available').total,1250);
  data.incomeQuotes[1].rate=1/1000;
  assert.equal(consolidatedIncome(data,'2026-09','USD','available').total,1000);
});

test('a giro updates both general accounts once and leaves the household budget unchanged',()=>{
  const data=base();
  data.accounts.push({id:'bob-transfer',currency:'BOB',method:'Transferencia',name:'Transferencia',opening:1000});
  data.accounts[0].opening=0;
  const giro=entry('giro-1','giro',300,'giro',{currency:'BOB',accountId:'bob-transfer',toAccountId:'ars-transfer',received:50_000,giroProfit:7_000});
  assert.equal(canApplyEntry(data,giro),null);
  data.entries.push(giro);
  assert.equal(accountBalance(data,'bob-transfer'),700);
  assert.equal(accountBalance(data,'ars-transfer'),50_000);
  assert.equal(everydayExpenses(data,'ARS',month).length,0);
  assert.equal(incomeAmount(data,'ARS',month,'available'),0);
  assert.equal(incomeAmount(data,'ARS',month,'combined'),0);
  assert.equal(accountBalance(data,'ars-transfer'),50_000);
  data.entries=[];
  assert.equal(accountBalance(data,'bob-transfer'),1000);
  assert.equal(accountBalance(data,'ars-transfer'),0);
});

test('editing and removing a giro reverse both sides of the linked operation',()=>{
  const data=base();data.accounts.push({id:'bob-transfer',currency:'BOB',method:'Transferencia',name:'Transferencia',opening:1000});data.accounts[0].opening=0;
  const original=entry('giro-1','giro',300,'giro',{currency:'BOB',accountId:'bob-transfer',toAccountId:'ars-transfer',received:50_000,giroProfit:7_000});
  data.entries=[original];
  const edited={...original,amount:200,received:40_000,giroProfit:5_000};
  const without={...data,entries:[]};
  assert.equal(canApplyEntry(without,edited),null);
  data.entries=[edited];
  assert.equal(accountBalance(data,'bob-transfer'),800);
  assert.equal(accountBalance(data,'ars-transfer'),40_000);
  data.entries=[];
  assert.equal(accountBalance(data,'bob-transfer'),1000);
  assert.equal(accountBalance(data,'ars-transfer'),0);
});

test('money formatting and balances keep currency decimal precision',()=>{
  const data=base();data.accounts[0].opening=1_500_000.50;
  data.entries=[entry('small','expense',.25)];
  assert.equal(accountBalance(data,'ars-transfer'),1_500_000.25);
  assert.equal(formatMoney(1_500_000.50,'ARS'),'$1.500.000,50');
  assert.equal(formatMoney(1250.75,'USD'),'US$1.250,75');
  assert.equal(formatMoney(1250.123456,'USDT'),'1.250,123456 USDT');
  assert.equal(roundMoney(.1+.2,'ARS'),.3);
  assert.equal(roundMoney(1.005,'ARS'),1.01);
  assert.equal(roundMoney(-1.005,'ARS'),-1.01);
});

test('loading older giros removes cost and growth options without losing the linked amounts',()=>{
  const old=base();old.accounts.push({id:'bob-transfer',currency:'BOB',method:'Transferencia',name:'Transferencia',opening:1000});
  old.entries=[entry('old-giro','giro',300,'giro',{currency:'BOB',accountId:'bob-transfer',toAccountId:'ars-transfer',received:50_000,giroCost:43_000,giroProfit:7_000,giroProfitAsIncome:true})];
  const previous=globalThis.localStorage;
  globalThis.localStorage={getItem:key=>key==='duo-v3-data-personal'?JSON.stringify(old):null};
  try{const loaded=loadData();assert.equal(loaded.entries[0].giroCost,undefined);assert.equal(loaded.entries[0].giroProfitAsIncome,undefined);assert.equal(loaded.entries[0].giroProfit,7000);assert.equal(accountBalance(loaded,'BOB-transferencia'),700);assert.equal(incomeAmount(loaded,'ARS',month,'available'),0)}finally{globalThis.localStorage=previous}
});

test('editing and deleting a household expense update the same ledger once',()=>{
  const data=base();const original=entry('purchase','expense',150_000);data.entries=[original];
  assert.equal(accountBalance(data,'ars-transfer'),850_000);
  const corrected={...original,amount:15_000};
  assert.equal(canApplyEntry({...data,entries:[]},corrected),null);
  data.entries=[corrected];
  assert.equal(accountBalance(data,'ars-transfer'),985_000);
  assert.equal(everydayExpenses(data,'ARS',month).reduce((sum,e)=>sum+e.amount,0),15_000);
  data.entries=[];
  assert.equal(accountBalance(data,'ars-transfer'),1_000_000);
});

test('personal data persist and fictitious demo movements never enter the active ledger',()=>{
  const storage=new Map();const previous=globalThis.localStorage;
  globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  try{
    const initial=loadData();assert.equal(initial.entries.length,0);
    initial.entries.push(entry('real','expense',12_000,'everyday',{accountId:'ARS-transferencia'}));saveData(initial);
    const reloaded=loadData();assert.equal(reloaded.entries.length,1);
    assert.equal(reloaded.entries[0].id,'real');
    assert.equal(accountBalance(reloaded,'ARS-transferencia'),-12_000);
  }finally{globalThis.localStorage=previous}
});

test('legacy demo migration keeps custom records but removes the sample ledger',()=>{
  const old=demoData();old.entries.push({...old.entries[0],id:'my-expense',amount:12_000,description:'Compra real'});
  const previous=globalThis.localStorage;
  globalThis.localStorage={getItem:key=>key==='duo-v3-data-demo'?JSON.stringify(old):null};
  try{const loaded=loadData();assert.deepEqual(loaded.entries.map(e=>e.id),['my-expense']);assert.equal(loaded.budget.amount,0);assert.equal(loaded.accounts.find(a=>a.id==='ARS-transferencia').opening,0)}finally{globalThis.localStorage=previous}
});

test('a historical giro gain in another currency stays separate from personal income',()=>{
  const data=base();data.accounts.push({id:'bob-transfer',currency:'BOB',method:'Transferencia',name:'Transferencia',opening:1000});
  const giro=entry('other-currency','giro',300,'giro',{currency:'BOB',accountId:'bob-transfer',toAccountId:'ars-transfer',received:50_000,giroProfit:10,giroProfitCurrency:'USD'});
  assert.equal(canApplyEntry(data,giro),null);
  data.entries=[giro];
  assert.equal(incomeAmount(data,'USD',month,'available'),0);
  assert.equal(incomeAmount(data,'ARS',month,'available'),0);
  assert.equal(accountBalance(data,'ars-transfer'),1_050_000);
});

test('donut selection returns to total and history renders only the chosen page',()=>{
  assert.equal(toggleCategorySelection(null,'telas'),'telas');
  assert.equal(toggleCategorySelection('telas','telas'),null);
  assert.equal(toggleCategorySelection('telas','confeccion'),'confeccion');
  const entries=Array.from({length:53},(_,i)=>i+1);
  assert.deepEqual(paginate(entries,1,20),{pages:3,currentPage:1,visible:entries.slice(0,20)});
  assert.deepEqual(paginate(entries,3,20),{pages:3,currentPage:3,visible:entries.slice(40)});
  assert.equal(paginate(entries,1,10).visible.length,10);
  assert.equal(paginate(entries,2,50).visible.length,3);
});

