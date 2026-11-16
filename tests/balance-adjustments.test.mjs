import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBalance,businessBalance,currencyBalance,everydayExpenses,includeBalanceAdjustment,incomeAmount,mergeConfirmedBalanceAdjustments,uniqueBalanceAdjustments} from '../src/domain.ts';
import {adjustFinanceAccountBalance,loadFinanceSpace} from '../src/finance-remote.ts';
import {giroMonthlyBalance} from '../src/giro-accounting.ts';
import {emptyData} from '../src/data.ts';

test('an audit adjustment changes only its account and keeps every historical entry',()=>{
  const data=emptyData();
  const bob=data.accounts.find(a=>a.id==='BOB-efectivo');
  const other=data.accounts.find(a=>a.id==='BOB-transferencia');
  const ars=data.accounts.find(a=>a.id==='ARS-efectivo');
  bob.opening=500;other.opening=100;ars.opening=1000;
  data.businessOpening.ARS=300;
  data.entries=[{id:'old-expense',kind:'expense',scope:'everyday',amount:20,currency:'BOB',accountId:bob.id,
    description:'Compra histórica',date:'2026-09-01'},
    {id:'old-giro',kind:'giro',scope:'giro',amount:10,currency:'BOB',accountId:bob.id,toAccountId:ars.id,
      received:100,giroProfit:5,giroProfitCurrency:'ARS',description:'Giro histórico',date:'2026-09-02'}];
  const historical=structuredClone(data.entries);
  const giroBefore=giroMonthlyBalance(data,'2026-09');
  const businessBefore=businessBalance(data,'ARS');
  assert.equal(accountBalance(data,bob.id),470);
  data.balanceAdjustments.push({id:'zero',accountId:bob.id,currency:'BOB',previousBalance:470,newBalance:0,
    delta:-470,reason:'Conteo físico',actorUserId:'user-a',actorName:'Dorian',createdAt:'2026-11-16T12:00:00Z'});
  assert.equal(accountBalance(data,bob.id),0);
  assert.equal(accountBalance(data,other.id),100);
  assert.equal(currencyBalance(data,'BOB'),100);
  data.balanceAdjustments.push({id:'increase',accountId:ars.id,currency:'ARS',previousBalance:1100,newBalance:1500,
    delta:400,reason:'Corrección',actorUserId:'user-b',actorName:'Dani',createdAt:'2026-11-16T12:01:00Z'});
  assert.equal(accountBalance(data,ars.id),1500);
  assert.deepEqual(data.entries,historical);
  assert.equal(everydayExpenses(data,'BOB','2026-09').length,1);
  assert.equal(incomeAmount(data,'ARS','2026-11','available'),0);
  assert.deepEqual(giroMonthlyBalance(data,'2026-09'),giroBefore);
  assert.equal(businessBalance(data,'ARS'),businessBefore);
});

test('adjustment RPC passes expected balance and request ID, and returns the audit row',async()=>{
  const calls=[];
  const client={rpc:async(name,args)=>{calls.push({name,args});return {data:{id:'adjustment',account_id:'BOB-efectivo',
    currency:'BOB',previous_balance:'500',new_balance:'0',delta:'-500',reason:'Conteo',actor_user_id:'user-a',
    actor_name:'Dorian',created_at:'2026-11-16T12:00:00Z'},error:null}}};
  const saved=await adjustFinanceAccountBalance(client,'space-a','BOB-efectivo',0,500,'Conteo','request-a');
  assert.deepEqual(calls,[{name:'adjust_finance_account_balance',args:{p_space_id:'space-a',p_account_id:'BOB-efectivo',
    p_new_balance:0,p_expected_balance:500,p_reason:'Conteo',p_request_id:'request-a'}}]);
  assert.equal(saved.delta,-500);
  assert.equal(saved.actorName,'Dorian');
  await assert.rejects(adjustFinanceAccountBalance({rpc:async()=>({error:{message:'No pertenecés a este espacio'}})},
    'space-b','BOB-efectivo',0,500,'','request-b'),/No pertenecés/);
});

test('shared data loads the adjustment history and includes its delta in the current balance',async()=>{
  const tables={finance_accounts:[{id:'BOB-efectivo',currency:'BOB',method:'Efectivo',name:'Efectivo',opening:'500'}],
    finance_balance_adjustments:[{id:'adjustment',account_id:'BOB-efectivo',currency:'BOB',previous_balance:'500',
      new_balance:'0',delta:'-500',reason:'Conteo',actor_user_id:'user-a',actor_name:'Dorian',created_at:'2026-11-16T12:00:00Z'}]};
  const client={from:table=>({select:()=>({eq:()=>({order(){return this},range:async()=>({data:tables[table]||[],error:null})})})})};
  const data=await loadFinanceSpace(client,'space-a');
  assert.equal(data.balanceAdjustmentsReady,true);
  assert.equal(data.balanceAdjustments.length,1);
  assert.equal(accountBalance(data,'BOB-efectivo'),0);
  assert.equal(data.balanceAdjustments[0].reason,'Conteo');
});

test('a failed reload after another sync included the adjustment does not add it twice',async()=>{
  const initial=emptyData();
  initial.accounts.find(a=>a.id==='BOB-efectivo').opening=500;
  const adjustment={id:'same-id',accountId:'BOB-efectivo',currency:'BOB',previousBalance:500,
    newBalance:0,delta:-500,reason:'Conteo',actorUserId:'owner',actorName:'Dorian',createdAt:'2026-11-16T12:00:00Z'};
  let state=initial;
  const setState=update=>{state=typeof update==='function'?update(state):update};
  let failReload;
  const reload=new Promise((_,reject)=>{failReload=reject});
  const save=reload.catch(()=>setState(previous=>includeBalanceAdjustment(previous,adjustment)));
  setState(includeBalanceAdjustment(initial,adjustment)); // Llegó la sincronización primero.
  failReload(new Error('Sin red'));
  await save;
  assert.equal(state.balanceAdjustments.length,1);
  assert.equal(accountBalance(state,'BOB-efectivo'),0);
  assert.equal(includeBalanceAdjustment(state,adjustment),state);
});

test('confirmed adjustments survive a stale concurrent sync and preserve one history row per id',async()=>{
  const initial=emptyData();
  initial.accounts.find(a=>a.id==='BOB-efectivo').opening=500;
  const adjustment={id:'same-id',accountId:'BOB-efectivo',currency:'BOB',previousBalance:500,
    newBalance:0,delta:-500,reason:'Conteo',actorUserId:'owner',actorName:'Dorian',createdAt:'2026-11-16T12:00:00Z'};
  const confirmed=new Map([[adjustment.id,adjustment]]);
  let state=initial;
  const setState=update=>{state=typeof update==='function'?update(state):update};
  await Promise.reject(new Error('Recarga fallida')).catch(()=>setState(previous=>includeBalanceAdjustment(previous,adjustment)));
  setState(mergeConfirmedBalanceAdjustments(initial,confirmed.values())); // La consulta había empezado antes de guardar.
  assert.equal(state.balanceAdjustments.length,1);
  assert.equal(accountBalance(state,'BOB-efectivo'),0);
  const synchronized=includeBalanceAdjustment(initial,adjustment);
  setState(mergeConfirmedBalanceAdjustments(synchronized,confirmed.values()));
  assert.equal(state.balanceAdjustments.length,1);
  assert.equal(accountBalance(state,'BOB-efectivo'),0);
  assert.equal(uniqueBalanceAdjustments([adjustment,adjustment]).length,1);
  assert.equal(accountBalance({...state,balanceAdjustments:[adjustment,adjustment]},'BOB-efectivo'),0);
});
