import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyData} from '../src/data.ts';
import {accountBalance,consolidatedIncome,currencyBalance,everydayExpenses,incomeAmount,incomeGoalAmount,reservedBalance} from '../src/domain.ts';
import {giroCapitalPending,giroDocumentedCost,giroMonthlyBalance,validateGiroLink} from '../src/giro-accounting.ts';

const month='2026-10';
const movement=(id,kind,amount,currency,accountId,toAccountId,received)=>({id,kind,scope:kind==='giro'?'giro':'everyday',amount,currency,accountId,toAccountId,received,description:id,date:'2026-10-10'});
const example=()=>{
  const data=emptyData();
  data.accounts.find(a=>a.id==='BOB-transferencia').opening=600;
  data.accounts.find(a=>a.id==='USDT-billetera').opening=8;
  data.accounts.find(a=>a.id==='ARS-transferencia').opening=90_000;
  const giro=movement('giro','giro',600,'BOB','BOB-transferencia','ARS-transferencia',100_000);
  const bob=movement('bob','transfer',8,'USDT','USDT-billetera','BOB-transferencia',600);
  const usdt=movement('usdt','transfer',90_000,'ARS','ARS-transferencia','USDT-billetera',8);
  data.entries=[giro,bob,usdt];
  return {data,giro};
};

test('two existing currency changes document a giro cost without changing balances or personal income',()=>{
  const {data,giro}=example();
  const balances=data.accounts.map(a=>accountBalance(data,a.id));
  const bob={id:'link-bob',giroId:giro.id,transferId:'bob',fromAmount:8,toAmount:600};
  const usdt={id:'link-usdt',giroId:giro.id,transferId:'usdt',fromAmount:90_000,toAmount:8};
  assert.equal(validateGiroLink(data,bob),null);
  data.giroLinks.push(bob);
  assert.equal(giroCapitalPending(data,giro),0);
  assert.equal(giroDocumentedCost(data,giro),null);
  assert.equal(validateGiroLink(data,usdt),null);
  data.giroLinks.push(usdt);
  assert.equal(giroDocumentedCost(data,giro),90_000);
  assert.deepEqual(data.accounts.map(a=>accountBalance(data,a.id)),balances);
  assert.equal(incomeAmount(data,'ARS',month,'available'),0);
  assert.equal(giroMonthlyBalance(data,month).count,1);
  data.giroResults.push({giroId:giro.id,costArs:90_000,feesArs:0,profitArs:10_000,evidence:'Dos cambios documentados',confirmedAt:'2026-10-24T15:00:00Z',recognizedMonth:month});
  assert.equal(giroMonthlyBalance(data,month).profitArs,0);
  assert.equal(data.giroResults[0].profitArs,10_000);
  assert.equal(incomeAmount(data,'ARS',month,'available'),0);
});

test('partial replenishment and allocations shared by multiple giros cannot use a change twice',()=>{
  const {data,giro}=example();
  data.giroLinks.push({id:'first',giroId:giro.id,transferId:'bob',fromAmount:4,toAmount:300});
  assert.equal(giroCapitalPending(data,giro),300);
  assert.match(validateGiroLink(data,{id:'repeat',giroId:giro.id,transferId:'bob',fromAmount:4,toAmount:300}),/ya está vinculado/);
  assert.match(validateGiroLink(data,{id:'second',giroId:'other',transferId:'bob',fromAmount:5,toAmount:375}),/Elegí un giro/);
  const other={...giro,id:'other',amount:300};data.entries.push(other);
  assert.match(validateGiroLink(data,{id:'second',giroId:'other',transferId:'bob',fromAmount:5,toAmount:375}),/asignado a otros giros/);
  assert.equal(validateGiroLink(data,{id:'second',giroId:'other',transferId:'bob',fromAmount:4,toAmount:300}),null);
});

test('historical results and later replenishment stay stored without entering declared monthly profit',()=>{
  const {data,giro}=example();
  data.giroResults.push({giroId:giro.id,costArs:90_000,feesArs:2_000,profitArs:8_000,evidence:'Costo comprobado fuera de la app',confirmedAt:'2026-11-02T15:00:00Z',recognizedMonth:'2026-11'});
  assert.equal(giroCapitalPending(data,giro),600);
  assert.equal(giroMonthlyBalance(data,'2026-10').profitArs,0);
  assert.equal(giroMonthlyBalance(data,'2026-11').profitArs,0);
  assert.equal(giroMonthlyBalance(data,'2026-10').count,1);
  const late={id:'late-bob',giroId:giro.id,transferId:'bob',fromAmount:8,toAmount:600};
  assert.equal(validateGiroLink(data,late),null);
  data.giroLinks.push(late);
  assert.equal(giroCapitalPending(data,giro),0);
  assert.equal(data.giroResults[0].recognizedMonth,'2026-11');
  assert.equal(giroMonthlyBalance(data,'2026-11').profitArs,0);
  assert.match(validateGiroLink(data,{id:'late-usdt',giroId:giro.id,transferId:'usdt',fromAmount:90_001,toAmount:8}),/asignado|corresponde|supera/);
});

test('many giros and currency changes leave salary goals, budget and savings untouched',()=>{
  const data=emptyData();
  const bob=data.accounts.find(a=>a.id==='BOB-transferencia');
  const usdt=data.accounts.find(a=>a.id==='USDT-billetera');
  const ars=data.accounts.find(a=>a.id==='ARS-transferencia');
  bob.opening=12_000;usdt.opening=100;ars.opening=100_000;
  const giros=Array.from({length:20},(_,index)=>({...movement(`giro-${index}`,'giro',600,'BOB',bob.id,ars.id,100_000),giroProfit:10_000,giroProfitCurrency:'ARS'}));
  data.entries=[...giros,movement('usdt-bob','transfer',8,'USDT',usdt.id,bob.id,620),
    movement('ars-usdt','transfer',90_000,'ARS',ars.id,usdt.id,8)];
  const balances=data.accounts.map(a=>accountBalance(data,a.id));
  assert.equal(accountBalance(data,bob.id),620);
  assert.equal(accountBalance(data,usdt.id),100);
  assert.equal(accountBalance(data,ars.id),2_010_000);
  assert.equal(currencyBalance(data,'ARS'),2_010_000);
  assert.equal(incomeAmount(data,'ARS',month,'available'),0);
  assert.equal(consolidatedIncome(data,month,'ARS','available').total,0);
  assert.equal(incomeGoalAmount(data,month,{month,currency:'ARS',view:'available',previous:0,target:1_000_000,growthType:'fixed',growth:0}),0);
  assert.deepEqual(everydayExpenses(data,'BOB',month),[]);
  assert.deepEqual(everydayExpenses(data,'ARS',month),[]);
  assert.equal(reservedBalance(data,'meta-inexistente'),0);
  assert.equal(giroMonthlyBalance(data,month).profitArs,200_000);
  assert.equal(giroMonthlyBalance(data,month).count,20);
  assert.equal(data.budget.amount-everydayExpenses(data,'ARS',month).reduce((sum,e)=>sum+e.amount,0),data.budget.amount);
  assert.deepEqual(data.accounts.map(a=>accountBalance(data,a.id)),balances);
});

test('using ARS from a giro for a real personal expense counts only that expense',()=>{
  const data=emptyData();
  data.accounts.find(a=>a.id==='BOB-transferencia').opening=600;
  const giro={...movement('giro','giro',600,'BOB','BOB-transferencia','ARS-transferencia',100_000),giroProfit:10_000};
  const expense={...movement('personal','expense',25_000,'ARS','ARS-transferencia'),scope:'everyday',categoryId:'comida'};
  data.entries=[giro,expense];
  assert.equal(accountBalance(data,'ARS-transferencia'),75_000);
  assert.equal(incomeAmount(data,'ARS',month,'available'),0);
  assert.equal(everydayExpenses(data,'ARS',month).reduce((sum,e)=>sum+e.amount,0),25_000);
  assert.equal(giroMonthlyBalance(data,month).profitArs,10_000);
});

test('salary and personal purchase affect goals and budget without counting giro profit twice',()=>{
  const {data,giro}=example();
  giro.giroProfit=10_000;
  data.entries.push({...movement('salary','income',250_000,'ARS','ARS-transferencia'),scope:'everyday'});
  data.entries.push({...movement('groceries','expense',25_000,'ARS','ARS-transferencia'),scope:'everyday',categoryId:'comida'});
  const goal={month,currency:'ARS',view:'available',previous:0,target:300_000,growthType:'fixed',growth:0};
  assert.equal(incomeAmount(data,'ARS',month,'available'),250_000);
  assert.equal(incomeGoalAmount(data,month,goal),250_000);
  assert.equal(consolidatedIncome(data,month,'ARS','available').total,250_000);
  assert.equal(everydayExpenses(data,'ARS',month).reduce((sum,e)=>sum+e.amount,0),25_000);
  assert.equal(data.budget.amount-everydayExpenses(data,'ARS',month).reduce((sum,e)=>sum+e.amount,0),-25_000);
  assert.equal(giroMonthlyBalance(data,month).profitArs,10_000);
  assert.equal(accountBalance(data,'ARS-transferencia'),325_000);
});
