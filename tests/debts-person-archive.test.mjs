import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBalance} from '../src/domain.ts';
import {archivePaidReceivable,debtProgressPercent,groupReceivablesByPerson,loadReceivables,paidAmount} from '../src/debts-remote.ts';

const debt=(id,person,principal,currency='BOB',archivedAt=null)=>({
  id,person,description:id,principal,currency,status:'open',archivedAt,
});
const payment=(id,receivableId,amount)=>({id,receivableId,amount,status:'active'});

test('case and spacing variants group one person while similar names stay separate',()=>{
  const debts=[debt('sale','Papá',3000),debt('loan',' papá ',1000),debt('other','PAPÁ',2000),
    debt('usd','Papá',20,'USD'),debt('another','Papá Pérez',500)];
  const payments=[payment('p1','sale',2000),payment('p2','loan',500),payment('p3','usd',5)];
  const groups=groupReceivablesByPerson(debts,payments);
  assert.equal(groups.length,2);
  assert.equal(groups[0].debts.length,4);
  assert.equal(groups[0].pendingByCurrency.BOB,3500);
  assert.equal(groups[0].pendingByCurrency.USD,15);
  assert.equal(groups[1].name,'Papá Pérez');
  assert.equal(groups[1].pendingByCurrency.BOB,500);
});

test('each debt keeps its own partial payment and progress bar',()=>{
  const debts=[debt('sale','Papá',3000),debt('loan','Papá',1000),debt('other','Papá',2000)];
  const payments=[payment('p1','sale',2000),payment('p2','loan',500)];
  assert.ok(Math.abs(debtProgressPercent(debts[0],payments)-66.6666667)<0.001);
  assert.equal(debtProgressPercent(debts[1],payments),50);
  assert.equal(debtProgressPercent(debts[2],payments),0);
  payments.push(payment('p3','sale',500));
  assert.equal(paidAmount(debts[0],payments),2500);
  assert.equal(paidAmount(debts[1],payments),500);
  assert.equal(debtProgressPercent(debts[1],payments),50);
  assert.equal(groupReceivablesByPerson(debts,payments)[0].pendingByCurrency.BOB,3000);
});

test('archiving a paid debt hides only that debt and leaves payments and balances intact',()=>{
  const debts=[debt('paid','Papá',3000),debt('partial','Papá',1000),debt('unpaid','Papá',2000)];
  const payments=[payment('p1','paid',3000),payment('p2','partial',500)];
  const ledger={accounts:[{id:'bob',currency:'BOB',opening:100}],entries:[
    {id:'receipt',kind:'income',scope:'receivable',amount:3000,currency:'BOB',accountId:'bob',date:'2026-11-18'},
  ]};
  const before=accountBalance(ledger,'bob');
  const originalPayments=structuredClone(payments);
  debts[0]={...debts[0],archivedAt:'2026-11-18T12:00:00Z'};
  const active=debts.filter(item=>!item.archivedAt);
  const archived=debts.filter(item=>item.archivedAt);
  assert.deepEqual(active.map(item=>item.id),['partial','unpaid']);
  assert.deepEqual(archived.map(item=>item.id),['paid']);
  assert.equal(groupReceivablesByPerson(active,payments)[0].pendingByCurrency.BOB,2500);
  assert.equal(accountBalance(ledger,'bob'),before);
  assert.deepEqual(payments,originalPayments);
});

test('archiving calls only the protected RPC and surfaces errors',async()=>{
  const calls=[];
  const client={rpc:async(name,args)=>{calls.push({name,args});return {error:null}}};
  await archivePaidReceivable(client,'space','paid');
  assert.deepEqual(calls,[{name:'archive_paid_finance_receivable',args:{p_space_id:'space',p_receivable_id:'paid'}}]);
  await assert.rejects(archivePaidReceivable({rpc:async()=>({error:{message:'Saldo pendiente'}})},'space','partial'),
    /Saldo pendiente/);
});

test('an archived debt remains outside the main list after reloading remote rows',async()=>{
  const rows={finance_receivables:[{id:'paid',space_id:'space',owner_user_id:'user',person:'Papá',
    description:'Venta',principal:'3000',currency:'BOB',status:'open',archived_at:'2026-11-18T12:00:00Z'}],
    finance_receivable_payments:[],finance_receivable_payment_revisions:[]};
  const client={from(table){return {select(){return this},eq(){return this},async order(){return {data:rows[table],error:null}}}}};
  const reloaded=await loadReceivables(client,'space','user');
  assert.equal(reloaded.archiveReady,true);
  assert.equal(reloaded.debts.filter(item=>!item.archivedAt).length,0);
  assert.equal(reloaded.debts.filter(item=>item.archivedAt).length,1);
});
