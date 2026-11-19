import type {SupabaseClient} from '@supabase/supabase-js';
import type {Currency} from './domain';
import {currencyScale} from './domain.ts';

export type Receivable={id:string;spaceId:string;ownerUserId:string;person:string;description:string;
  principal:number;currency:Currency;createdOn:string;dueOn:string|null;notes:string;status:'open'|'cancelled';
  debtType:'loan'|'owed';sourceAccountId:string|null;originEntryId:string|null;
  cancellationMode:'close_only'|'record_return'|null;archivedAt:string|null};
export type ReceivablePayment={id:string;receivableId:string;amount:number;currency:Currency;
  accountId:string|null;entryId:string|null;linkedExisting:boolean;paidAt:string;
  paymentReason:'collection'|'cancellation_return';mode:'account'|'control';status:'active'|'void';
  note:string;revision:number};
export type PaymentRevision={id:string;paymentId:string;revision:number;action:'edit'|'void'|'move';
  oldReceivableId:string;newReceivableId:string;oldAmount:number;newAmount:number;
  oldMode:'account'|'control';newMode:'account'|'control';oldAccountId:string|null;
  newAccountId:string|null;oldNote:string;newNote:string;changedAt:string};
export type ReceivableState='pending'|'partial'|'paid'|'cancelled';

export function paidAmount(debt:Receivable,payments:ReceivablePayment[]){
  const scale=currencyScale(debt.currency);
  return payments.filter(p=>p.receivableId===debt.id&&p.status!=='void').reduce((sum,p)=>sum+Math.round(p.amount*scale),0)/scale;
}
export function receivableState(debt:Receivable,payments:ReceivablePayment[]):ReceivableState{
  if(debt.status==='cancelled')return 'cancelled';
  const paid=paidAmount(debt,payments);
  return paid>=debt.principal?'paid':paid>0?'partial':'pending';
}
export const personGroupKey=(name:string)=>name.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('es-AR');
export const debtProgressPercent=(debt:Receivable,payments:ReceivablePayment[])=>
  Math.min(100,Math.max(0,paidAmount(debt,payments)/debt.principal*100));
export function groupReceivablesByPerson(debts:Receivable[],payments:ReceivablePayment[]){
  const groups=new Map<string,{key:string;name:string;debts:Receivable[];pendingByCurrency:Partial<Record<Currency,number>>}>();
  for(const debt of debts){
    const key=personGroupKey(debt.person);
    let group=groups.get(key);
    if(!group){group={key,name:debt.person.trim().replace(/\s+/g,' '),debts:[],pendingByCurrency:{}};groups.set(key,group)}
    group.debts.push(debt);
    if(debt.status==='open'){
      const scale=currencyScale(debt.currency);
      const pending=Math.max(0,Math.round((debt.principal-paidAmount(debt,payments))*scale));
      group.pendingByCurrency[debt.currency]=
        (Math.round((group.pendingByCurrency[debt.currency]||0)*scale)+pending)/scale;
    }
  }
  return [...groups.values()];
}
const fail=(error:{message:string}|null)=>{if(error)throw new Error(error.message)};
export async function loadReceivables(client:SupabaseClient,spaceId:string,userId:string){
  const [debts,payments,revisions]=await Promise.all([
    client.from('finance_receivables').select('*').eq('space_id',spaceId).eq('owner_user_id',userId)
      .order('created_on',{ascending:false}),
    client.from('finance_receivable_payments').select('*').eq('space_id',spaceId)
      .order('paid_at',{ascending:false}),
    client.from('finance_receivable_payment_revisions').select('*').eq('space_id',spaceId)
      .order('changed_at',{ascending:false}),
  ]);
  fail(debts.error);fail(payments.error);
  const correctionsReady=!revisions.error;
  if(revisions.error&&!/could not find|does not exist|relation .* does not exist/i.test(revisions.error.message))
    fail(revisions.error);
  return {
    correctionsReady,
    archiveReady:(debts.data||[]).some(row=>Object.prototype.hasOwnProperty.call(row,'archived_at')),
    debts:(debts.data||[]).map(row=>({id:row.id,spaceId:row.space_id,ownerUserId:row.owner_user_id,
      person:row.person,description:row.description,principal:Number(row.principal),currency:row.currency,
      createdOn:row.created_on,dueOn:row.due_on,notes:row.notes,status:row.status,
      debtType:row.debt_type,sourceAccountId:row.source_account_id,originEntryId:row.origin_entry_id,
      cancellationMode:row.cancellation_mode,archivedAt:row.archived_at||null} as Receivable)),
    payments:(payments.data||[]).map(row=>({id:row.id,receivableId:row.receivable_id,
      amount:Number(row.amount),currency:row.currency,accountId:row.account_id,entryId:row.entry_id,
      linkedExisting:row.linked_existing,paidAt:row.paid_at,paymentReason:row.payment_reason,
      mode:row.mode||'account',status:row.status||'active',note:row.note||'',revision:row.revision||0} as ReceivablePayment)),
    revisions:(revisions.data||[]).map(row=>({id:row.id,paymentId:row.payment_id,revision:row.revision,
      action:row.action,oldReceivableId:row.old_receivable_id,newReceivableId:row.new_receivable_id,
      oldAmount:Number(row.old_amount),newAmount:Number(row.new_amount),oldMode:row.old_mode,newMode:row.new_mode,
      oldAccountId:row.old_account_id,newAccountId:row.new_account_id,oldNote:row.old_note,
      newNote:row.new_note,changedAt:row.changed_at} as PaymentRevision)),
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
export async function archivePaidReceivable(client:SupabaseClient,spaceId:string,id:string){
  const result=await client.rpc('archive_paid_finance_receivable',{p_space_id:spaceId,p_receivable_id:id});
  fail(result.error);
}
export async function recordReceivablePayment(client:SupabaseClient,spaceId:string,debtId:string,
  paymentId:string,amount:number,mode:'account'|'control',accountId:string|null,
  note:string,existingEntryId:string|null){
  const result=await client.rpc('record_finance_receivable_payment_v2',{
    p_space_id:spaceId,p_receivable_id:debtId,p_payment_id:paymentId,
    p_amount:amount,p_mode:mode,p_account_id:accountId,p_note:note,p_existing_entry_id:existingEntryId,
  });
  fail(result.error);
}

export async function correctReceivablePayment(client:SupabaseClient,spaceId:string,payment:ReceivablePayment,
  requestId:string,action:'edit'|'void'|'move',targetDebtId:string,amount:number|null,
  mode:'account'|'control'|null,accountId:string|null,note:string){
  const result=await client.rpc('correct_finance_receivable_payment',{
    p_space_id:spaceId,p_payment_id:payment.id,p_request_id:requestId,
    p_expected_revision:payment.revision,p_action:action,p_target_receivable_id:targetDebtId,
    p_amount:amount,p_mode:mode,p_account_id:accountId,p_note:note,
  });
  fail(result.error);
}
