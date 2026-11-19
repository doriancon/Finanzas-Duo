import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBalance,incomeAmount} from '../src/domain.ts';
import {correctReceivablePayment,loadReceivables,paidAmount,receivableState,recordReceivablePayment} from '../src/debts-remote.ts';

test('a corrected 300,000 receipt counts as 220,000 and leaves 280,000 pending',()=>{
  const debt={id:'a',principal:500000,currency:'ARS',status:'open'};
  const payment={id:'p',receivableId:'a',amount:220000,currency:'ARS',mode:'account',status:'active'};
  const ledger={accounts:[{id:'ars',currency:'ARS',opening:0}],entries:[
    {id:'initial',kind:'income',scope:'receivable',amount:300000,currency:'ARS',accountId:'ars',date:'2026-11-18'},
    {id:'correction',kind:'expense',scope:'receivable',amount:80000,currency:'ARS',accountId:'ars',date:'2026-11-18'},
  ]};
  assert.equal(paidAmount(debt,[payment]),220000);
  assert.equal(debt.principal-paidAmount(debt,[payment]),280000);
  assert.equal(receivableState(debt,[payment]),'partial');
  assert.equal(accountBalance(ledger,'ars'),220000);
  assert.equal(incomeAmount(ledger,'ARS','2026-11','available'),0);
});

test('control payment and its void change only the debt',()=>{
  const debt={id:'a',principal:1000,currency:'BOB',status:'open'};
  const ledger={accounts:[{id:'bob',currency:'BOB',opening:100}],entries:[]};
  const payment={id:'p',receivableId:'a',amount:300,currency:'BOB',mode:'control',status:'active'};
  assert.equal(paidAmount(debt,[payment]),300);
  assert.equal(debt.principal-paidAmount(debt,[payment]),700);
  assert.equal(accountBalance(ledger,'bob'),100);
  assert.equal(paidAmount(debt,[{...payment,amount:0,status:'void'}]),0);
  assert.equal(accountBalance(ledger,'bob'),100);
});

test('moving a real payment changes debt ownership, not the ledger',()=>{
  const first={id:'a',principal:500000,currency:'ARS',status:'open'};
  const second={id:'b',principal:300000,currency:'ARS',status:'open'};
  const payment={id:'p',receivableId:'b',amount:100000,currency:'ARS',mode:'account',status:'active'};
  const ledger={accounts:[{id:'ars',currency:'ARS',opening:0}],entries:[
    {id:'receipt',kind:'income',scope:'receivable',amount:100000,currency:'ARS',accountId:'ars',date:'2026-11-18'},
  ]};
  assert.equal(paidAmount(first,[payment]),0);
  assert.equal(paidAmount(second,[payment]),100000);
  assert.equal(accountBalance(ledger,'ars'),100000);
});

test('payment RPCs pass mode, request ID and expected revision without client ledger writes',async()=>{
  const calls=[];
  const client={rpc:async(name,args)=>{calls.push({name,args});return {data:{},error:null}}};
  await recordReceivablePayment(client,'space','debt','payment',300,'control',null,'Solo control',null);
  const payment={id:'payment',revision:2};
  await correctReceivablePayment(client,'space',payment,'request','void','debt',null,null,null,'Error');
  assert.equal(calls[0].name,'record_finance_receivable_payment_v2');
  assert.equal(calls[0].args.p_mode,'control');
  assert.equal(calls[0].args.p_account_id,null);
  assert.equal(calls[1].name,'correct_finance_receivable_payment');
  assert.equal(calls[1].args.p_request_id,'request');
  assert.equal(calls[1].args.p_expected_revision,2);
  assert.equal(calls[1].args.p_action,'void');
});

test('existing debts remain readable before the corrections migration is applied',async()=>{
  const client={from(table){return {
    select(){return this},eq(){return this},async order(){
      return table==='finance_receivable_payment_revisions'
        ?{data:null,error:{message:"Could not find the table 'public.finance_receivable_payment_revisions' in schema cache"}}
        :{data:[],error:null};
    },
  }}};
  const result=await loadReceivables(client,'space','user');
  assert.equal(result.correctionsReady,false);
  assert.equal(result.archiveReady,false);
  assert.deepEqual(result.debts,[]);
  assert.deepEqual(result.payments,[]);
});
