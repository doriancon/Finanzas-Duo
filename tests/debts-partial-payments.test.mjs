import test from 'node:test';
import assert from 'node:assert/strict';
import {accountBalance,incomeAmount} from '../src/domain.ts';
import {paidAmount,receivableState} from '../src/debts-remote.ts';

test('partial repayments update the debt and account once without personal income',()=>{
  const debt={id:'debt-500k',principal:500000,currency:'ARS',status:'open'};
  const payments=[];
  const ledger={accounts:[{id:'ars',currency:'ARS',opening:0}],entries:[]};
  for(const [id,amount,remaining,state] of [
    ['first',200000,300000,'partial'],
    ['second',100000,200000,'partial'],
    ['last',200000,0,'paid'],
  ]){
    payments.push({id,receivableId:debt.id,amount,currency:'ARS'});
    ledger.entries.push({id:`payment-${id}`,kind:'income',scope:'receivable',amount,
      currency:'ARS',accountId:'ars',date:'2026-10-29'});
    assert.equal(debt.principal-paidAmount(debt,payments),remaining);
    assert.equal(receivableState(debt,payments),state);
    assert.equal(accountBalance(ledger,'ars'),paidAmount(debt,payments));
    assert.equal(incomeAmount(ledger,'ARS','2026-10','available'),0);
  }
  assert.equal(ledger.entries.length,3);
});
