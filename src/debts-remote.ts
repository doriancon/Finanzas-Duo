import type {SupabaseClient} from '@supabase/supabase-js';
import type {Currency} from './domain';
import {currencyScale} from './domain.ts';

export type Receivable={id:string;spaceId:string;ownerUserId:string;person:string;description:string;
  principal:number;currency:Currency;createdOn:string;dueOn:string|null;notes:string;status:'open'|'cancelled';
  debtType:'loan'|'owed';sourceAccountId:string|null;originEntryId:string|null;
  cancellationMode:'close_only'|'record_return'|null};
export type ReceivablePayment={id:string;receivableId:string;amount:number;currency:Currency;
  accountId:string;entryId:string;linkedExisting:boolean;paidAt:string;
  paymentReason:'collection'|'cancellation_return'};
export type ReceivableState='pending'|'partial'|'paid'|'cancelled';

export function paidAmount(debt:Receivable,payments:ReceivablePayment[]){
  const scale=currencyScale(debt.currency);
  return payments.filter(p=>p.receivableId===debt.id).reduce((sum,p)=>sum+Math.round(p.amount*scale),0)/scale;
}
export function receivableState(debt:Receivable,payments:ReceivablePayment[]):ReceivableState{
  if(debt.status==='cancelled')return 'cancelled';
  const paid=paidAmount(debt,payments);
  return paid>=debt.principal?'paid':paid>0?'partial':'pending';
}
const fail=(error:{message:string}|null)=>{if(error)throw new Error(error.message)};
export async function loadReceivables(client:SupabaseClient,spaceId:string,userId:string){
  const [debts,payments]=await Promise.all([
    client.from('finance_receivables').select('*').eq('space_id',spaceId).eq('owner_user_id',userId)
      .order('created_on',{ascending:false}),
    client.from('finance_receivable_payments').select('*').eq('space_id',spaceId)
      .order('paid_at',{ascending:false}),
  ]);
  fail(debts.error);fail(payments.error);
  return {
    debts:(debts.data||[]).map(row=>({id:row.id,spaceId:row.space_id,ownerUserId:row.owner_user_id,
      person:row.person,description:row.description,principal:Number(row.principal),currency:row.currency,
      createdOn:row.created_on,dueOn:row.due_on,notes:row.notes,status:row.status,
      debtType:row.debt_type,sourceAccountId:row.source_account_id,originEntryId:row.origin_entry_id,
      cancellationMode:row.cancellation_mode} as Receivable)),
    payments:(payments.data||[]).map(row=>({id:row.id,receivableId:row.receivable_id,
      amount:Number(row.amount),currency:row.currency,accountId:row.account_id,entryId:row.entry_id,
      linkedExisting:row.linked_existing,paidAt:row.paid_at,
      paymentReason:row.payment_reason} as ReceivablePayment)),
  };
}
export async function saveReceivable(client:SupabaseClient,spaceId:string,userId:string,debt:Receivable){
  const row={space_id:spaceId,id:debt.id,owner_user_id:userId,person:debt.person.trim(),
    description:debt.description.trim(),principal:debt.principal,currency:debt.currency,
    created_on:debt.createdOn,due_on:debt.dueOn||null,notes:debt.notes.trim(),status:debt.status,
    debt_type:debt.debtType,source_account_id:debt.sourceAccountId,
    origin_entry_id:debt.originEntryId,cancellation_mode:debt.cancellationMode};
  const result=debt.spaceId?await client.from('finance_receivables').update(row)
    .eq('space_id',spaceId).eq('id',debt.id).eq('owner_user_id',userId)
    :await client.from('finance_receivables').upsert(row,{onConflict:'space_id,id'});
  fail(result.error);
}
export async function createReceivableLoan(client:SupabaseClient,spaceId:string,debt:Receivable){
  const result=await client.rpc('create_finance_receivable_loan',{
    p_space_id:spaceId,p_receivable_id:debt.id,p_person:debt.person.trim(),
    p_description:debt.description.trim(),p_amount:debt.principal,p_currency:debt.currency,
    p_account_id:debt.sourceAccountId,p_created_on:debt.createdOn,
    p_due_on:debt.dueOn||null,p_notes:debt.notes.trim(),
  });
  fail(result.error);
}
export async function setReceivableStatus(client:SupabaseClient,spaceId:string,id:string,status:'open'|'cancelled'){
  const result=await client.from('finance_receivables').update({status,cancellation_mode:status==='open'?null:'close_only'})
    .eq('space_id',spaceId).eq('id',id);
  fail(result.error);
}
export async function cancelReceivable(client:SupabaseClient,spaceId:string,id:string,
  mode:'close_only'|'record_return',returnAccountId:string|null){
  const result=await client.rpc('cancel_finance_receivable',{
    p_space_id:spaceId,p_receivable_id:id,p_mode:mode,p_return_account_id:returnAccountId,
  });
  fail(result.error);
}
export async function deleteReceivable(client:SupabaseClient,spaceId:string,id:string){
  const result=await client.from('finance_receivables').delete().eq('space_id',spaceId).eq('id',id);
  fail(result.error);
}
export async function recordReceivablePayment(client:SupabaseClient,spaceId:string,debtId:string,
  paymentId:string,amount:number,accountId:string,existingEntryId:string|null){
  const result=await client.rpc('record_finance_receivable_payment',{
    p_space_id:spaceId,p_receivable_id:debtId,p_payment_id:paymentId,
    p_amount:amount,p_account_id:accountId,p_existing_entry_id:existingEntryId,
  });
  fail(result.error);
}
