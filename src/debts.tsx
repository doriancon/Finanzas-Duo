import {useCallback,useEffect,useMemo,useState} from 'react';
import type {FormEvent} from 'react';
import {Plus,Search} from 'lucide-react';
import type {Currency,FinanceData} from './domain';
import {accountBalance,CURRENCIES,currencyScale,dateISO,formatMoney} from './domain';
import {MoneyField,moneyText,moneyTextError,parseMoneyText} from './money-field';
import {SheetFrame} from './ui';
import {supabase} from './supabase';
import {archivePaidReceivable,cancelReceivable,correctReceivablePayment,createReceivableLoan,debtProgressPercent,
  deleteReceivable,groupReceivablesByPerson,loadReceivables,paidAmount,receivableState,recordReceivablePayment,
  saveReceivable,setReceivableStatus,
  type PaymentRevision,type Receivable,type ReceivablePayment,type ReceivableState} from './debts-remote';

const states:Record<ReceivableState,string>={pending:'Pendiente',partial:'Pago parcial',
  paid:'Cobrada',cancelled:'Anulada'};
const today=()=>dateISO(new Date());

function DebtEditor({debt,data,enabledCurrencies,onClose,onSaved,onLedgerChanged,spaceId,userId}:{debt:Receivable|null;
  data:FinanceData;enabledCurrencies:Currency[];onClose:()=>void;onSaved:()=>Promise<void>;
  onLedgerChanged:()=>Promise<void>;spaceId:string;userId:string}){
  const [debtType,setDebtType]=useState<Receivable['debtType']>(debt?.debtType||'owed');
  const [person,setPerson]=useState(debt?.person||'');
  const [description,setDescription]=useState(debt?.description||'');
  const [currency,setCurrency]=useState<Currency>(debt?.currency||enabledCurrencies[0]||'ARS');
  const [sourceAccountId,setSourceAccountId]=useState(debt?.sourceAccountId||data.accounts.find(account=>account.currency===(enabledCurrencies[0]||'ARS'))?.id||'');
  const [principal,setPrincipal]=useState(moneyText(debt?.principal,debt?.currency||enabledCurrencies[0]||'ARS'));
  const [createdOn,setCreatedOn]=useState(debt?.createdOn||today());
  const [dueOn,setDueOn]=useState(debt?.dueOn||'');
  const [notes,setNotes]=useState(debt?.notes||'');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [draftId]=useState(()=>crypto.randomUUID());
  const sourceAccounts=data.accounts.filter(account=>account.currency===currency);
  const sourceAccount=sourceAccounts.find(account=>account.id===sourceAccountId);
  const save=async(event:FormEvent)=>{
    event.preventDefault();
    const problem=moneyTextError(principal,currency);
    if(problem)return setError(problem);
    if(debtType==='loan'&&!debt){
      if(!sourceAccount)return setError('Elegí una cuenta de la misma moneda para entregar el préstamo.');
      if(accountBalance(data,sourceAccount.id)<parseMoneyText(principal))
        return setError('La cuenta no tiene saldo suficiente para entregar el préstamo.');
    }
    if(!supabase)return setError('Iniciá sesión para guardar la deuda.');
    setBusy(true);setError('');
    try{
      const record:Receivable={
        id:debt?.id||draftId,spaceId:debt?.spaceId||'',ownerUserId:userId,
        person,description,principal:parseMoneyText(principal),currency,createdOn,
        dueOn:dueOn||null,notes,status:debt?.status||'open',
        debtType,sourceAccountId:debt?.sourceAccountId||null,originEntryId:debt?.originEntryId||null,
        cancellationMode:debt?.cancellationMode||null,archivedAt:debt?.archivedAt||null,
      };
      if(debtType==='loan'&&!debt){record.sourceAccountId=sourceAccountId;
        await createReceivableLoan(supabase,spaceId,record)}
      else await saveReceivable(supabase,spaceId,userId,record);
      if(debtType==='loan'&&!debt)await onLedgerChanged();
      await onSaved();onClose();
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo guardar la deuda.')}
    finally{setBusy(false)}
  };
  return <SheetFrame title={debt?'Editar deuda':'Nueva deuda por cobrar'} onClose={onClose}>
    <form className="movement-form" onSubmit={save}>
      {!debt?<label>Tipo de deuda<select value={debtType} onChange={event=>setDebtType(event.target.value as Receivable['debtType'])}>
        <option value="owed">Me deben dinero · no salió de mis cuentas</option>
        <option value="loan">Presté dinero · sale de una cuenta</option>
      </select></label>:<p className="form-hint">{debtType==='loan'?'Préstamo entregado desde una cuenta':'Dinero que no salió de tus cuentas'}</p>}
      <p className="form-hint">{debtType==='loan'?'Al crearla, el importe se descontará de la cuenta elegida y quedará por cobrar. No contará como gasto personal.':'Registrar la deuda no cambia las cuentas ni crea un ingreso.'}</p>
      <label>Persona o cliente<input value={person} onChange={event=>setPerson(event.target.value)} maxLength={120} required/></label>
      <label>Concepto<input value={description} onChange={event=>setDescription(event.target.value)} maxLength={240} required/></label>
      <div className="form-grid"><label>Monto<MoneyField value={principal} onChange={setPrincipal} currency={currency} readOnly={Boolean(debt&&debtType==='loan')} required/></label>
        <label>Moneda<select value={currency} onChange={event=>{const next=event.target.value as Currency;setCurrency(next);setSourceAccountId(data.accounts.find(account=>account.currency===next)?.id||'')}} disabled={Boolean(debt&&debtType==='loan')}>
          {CURRENCIES.filter(item=>enabledCurrencies.includes(item)||item===debt?.currency).map(item=><option key={item}>{item}</option>)}
        </select></label></div>
      {debtType==='loan'&&<label>Cuenta desde la que entregaste el dinero<select value={sourceAccountId} onChange={event=>setSourceAccountId(event.target.value)} disabled={Boolean(debt)} required>
        {sourceAccounts.map(account=><option key={account.id} value={account.id}>{account.currency} · {account.name} · disponible {formatMoney(accountBalance(data,account.id),account.currency)}</option>)}
      </select></label>}
      <div className="form-grid"><label>Fecha de creación<input type="date" value={createdOn} onChange={event=>setCreatedOn(event.target.value)} disabled={Boolean(debt)} required/></label>
        <label>Pago estimado (opcional)<input type="date" value={dueOn} onChange={event=>setDueOn(event.target.value)}/></label></div>
      <label>Notas (opcional)<textarea value={notes} onChange={event=>setNotes(event.target.value)} maxLength={2000} rows={3}/></label>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <button className="primary-button form-submit" disabled={busy}>{busy?'Guardando…':debt?'Guardar cambios':'Crear deuda'}</button>
    </form>
  </SheetFrame>;
}

function PaymentEditor({debt,payments,data,userId,onClose,onSaved,spaceId}:{debt:Receivable;
  payments:ReceivablePayment[];data:FinanceData;userId:string;onClose:()=>void;
  onSaved:()=>Promise<void>;spaceId:string}){
  const remaining=Math.max(0,Math.round((debt.principal-paidAmount(debt,payments))*currencyScale(debt.currency))/currencyScale(debt.currency));
  const [amount,setAmount]=useState('');
  const [accountId,setAccountId]=useState(data.accounts.find(account=>account.currency===debt.currency)?.id||'');
  const [existingId,setExistingId]=useState('');
  const [method,setMethod]=useState<'account'|'control'|'existing'>('account');
  const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [paymentId]=useState(()=>crypto.randomUUID());
  const accounts=data.accounts.filter(account=>account.currency===debt.currency);
  const linkedIds=new Set(payments.map(payment=>payment.entryId));
  const existing=data.entries.filter(entry=>entry.kind==='income'&&entry.scope!=='receivable'
    &&entry.currency===debt.currency&&entry.actorUserId===userId&&entry.amount<=remaining&&!linkedIds.has(entry.id));
  const selected=method==='existing'?existing.find(entry=>entry.id===existingId):undefined;
  const save=async(event:FormEvent)=>{
    event.preventDefault();
    const value=selected?selected.amount:parseMoneyText(amount);
    if(!selected){const problem=moneyTextError(amount,debt.currency);if(problem)return setError(problem)}
    if(method==='existing'&&!selected)return setError('Elegí un movimiento existente.');
    if(value>remaining)return setError('El cobro supera el saldo pendiente.');
    if(!supabase)return setError('Iniciá sesión para registrar el cobro.');
    setBusy(true);setError('');
    try{
      await recordReceivablePayment(supabase,spaceId,debt.id,paymentId,value,
        method==='control'?'control':'account',method==='control'?null:selected?.accountId||accountId,
        note.trim(),selected?.id||null);
      await onSaved();onClose();
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo registrar el cobro.')}
    finally{setBusy(false)}
  };
  return <SheetFrame title="Registrar pago" onClose={onClose}><form className="movement-form" onSubmit={save}>
    <div className="goal-preview"><span>{debt.person} · {debt.currency}</span><strong>{formatMoney(remaining,debt.currency)} pendientes</strong></div>
    <p className="form-hint">Podés registrar cualquier pago parcial hasta completar el saldo pendiente.</p>
    <label>Cómo registrar el pago<select value={method} onChange={event=>setMethod(event.target.value as typeof method)}>
      <option value="account">Pago recibido en una cuenta</option>
      <option value="control">Solo registrar pago · sin afectar saldo</option>
      {existing.length>0&&<option value="existing">Vincular un ingreso ya registrado</option>}
    </select></label>
    {method==='existing'&&<label>Movimiento ya registrado<select value={existingId} onChange={event=>setExistingId(event.target.value)} required>
      <option value="">Elegí el movimiento</option>
      {existing.map(entry=><option key={entry.id} value={entry.id}>{entry.date} · {formatMoney(entry.amount,entry.currency)} · {entry.description}</option>)}
    </select></label>}
    {selected?<p className="form-hint">{debt.debtType==='loan'
      ?'Se vinculará el ingreso existente y se clasificará como devolución de préstamo. No cambia el importe ni el saldo; dejará de contar como ingreso personal.'
      :'Se vinculará el ingreso existente. No se creará otro movimiento ni cambiará el saldo.'}</p>:method!=='existing'&&<>
      <label>Importe recibido<MoneyField value={amount} onChange={setAmount} currency={debt.currency} required/></label>
      {method==='account'&&<label>Cuenta receptora<select value={accountId} onChange={event=>setAccountId(event.target.value)} required>
        {accounts.map(account=><option key={account.id} value={account.id}>{account.currency} · {account.name}</option>)}
      </select></label>}
      <p className="form-hint">{method==='control'?'Solo disminuirá la deuda. No creará movimientos ni cambiará ninguna cuenta.':`El dinero ingresará una sola vez en la cuenta. ${debt.debtType==='loan'?'Recuperar capital no es ganancia ni ingreso personal.':'No entra en ingresos personales.'}`}</p>
    </>}
    <label>Nota (opcional)<input value={note} onChange={event=>setNote(event.target.value)} maxLength={500}/></label>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <button className="primary-button form-submit" disabled={busy||(method==='account'&&!accountId)||(method==='existing'&&!selected)}>{busy?'Guardando…':'Registrar pago'}</button>
  </form></SheetFrame>;
}

function PaymentCorrectionEditor({debt,payment,debts,payments,data,spaceId,initialAction,onClose,onSaved}:{debt:Receivable;
  payment:ReceivablePayment;debts:Receivable[];payments:ReceivablePayment[];data:FinanceData;
  spaceId:string;initialAction:'edit'|'void';onClose:()=>void;onSaved:()=>Promise<void>}){
  const [action,setAction]=useState<'edit'|'void'|'move'>(initialAction);
  const [amount,setAmount]=useState(moneyText(payment.amount,debt.currency));
  const [mode,setMode]=useState<'account'|'control'>(payment.mode);
  const [accountId,setAccountId]=useState(payment.accountId||data.accounts.find(a=>a.currency===debt.currency)?.id||'');
  const [targetId,setTargetId]=useState('');
  const [note,setNote]=useState(payment.note);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [requestId]=useState(()=>crypto.randomUUID());
  const targets=debts.filter(item=>item.id!==debt.id&&item.status==='open'&&item.currency===debt.currency
    &&item.principal-paidAmount(item,payments)>=payment.amount);
  const save=async(event:FormEvent)=>{
    event.preventDefault();
    if(!supabase)return setError('Iniciá sesión para corregir el pago.');
    let value:number|null=null;
    if(action==='edit'){
      const problem=moneyTextError(amount,debt.currency);if(problem)return setError(problem);
      value=parseMoneyText(amount);
      if(mode==='account'&&!accountId)return setError('Elegí la cuenta receptora.');
    }
    if(action==='move'&&!targetId)return setError('Elegí la deuda correcta.');
    const prompt=action==='void'
      ?payment.mode==='account'?'¿Anular este pago real? Se revertirá el importe recibido en la cuenta mediante un movimiento de corrección.':'¿Anular este pago de control? La cuenta no cambiará.'
      :action==='move'?'¿Mover este pago a la otra deuda? El dinero no ingresará ni saldrá nuevamente.'
      :'¿Guardar la corrección de este pago? La deuda y, si corresponde, la cuenta se actualizarán.';
    if(!window.confirm(prompt))return;
    setBusy(true);setError('');
    try{
      await correctReceivablePayment(supabase,spaceId,payment,requestId,action,
        action==='move'?targetId:debt.id,value,action==='edit'?mode:null,
        action==='edit'&&mode==='account'?accountId:null,action==='edit'||action==='void'?note.trim():payment.note);
      await onSaved();onClose();
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo corregir el pago.')}
    finally{setBusy(false)}
  };
  return <SheetFrame title="Corregir pago" onClose={onClose}><form className="movement-form" onSubmit={save}>
    <div className="goal-preview"><span>{debt.person} · {debt.currency}</span><strong>{formatMoney(payment.amount,debt.currency)}</strong></div>
    <label>Qué querés hacer<select value={action} onChange={event=>{setAction(event.target.value as typeof action);setError('')}}>
      <option value="edit">Editar pago</option><option value="void">Eliminar pago registrado por error</option>
      {targets.length>0&&<option value="move">Mover pago a otra deuda</option>}
    </select></label>
    {action==='edit'&&<><label>Importe correcto<MoneyField value={amount} onChange={setAmount} currency={debt.currency} required/></label>
      <label>Tipo de registro<select value={mode} onChange={event=>setMode(event.target.value as typeof mode)}>
        <option value="account">Pago recibido en una cuenta</option><option value="control">Solo control · sin afectar saldo</option>
      </select></label>
      {mode==='account'&&<label>Cuenta receptora<select value={accountId} onChange={event=>setAccountId(event.target.value)} required>
        {data.accounts.filter(a=>a.currency===debt.currency).map(a=><option key={a.id} value={a.id}>{a.currency} · {a.name}</option>)}
      </select></label>}
      <label>Nota (opcional)<input value={note} onChange={event=>setNote(event.target.value)} maxLength={500}/></label></>}
    {action==='move'&&<label>Deuda correcta<select value={targetId} onChange={event=>setTargetId(event.target.value)} required>
      <option value="">Elegí la deuda</option>{targets.map(item=><option key={item.id} value={item.id}>{item.person} · pendiente {formatMoney(item.principal-paidAmount(item,payments),item.currency)}</option>)}
    </select></label>}
    {action==='void'&&<p className="form-hint">El pago dejará de contar en esta deuda. Se conservará su historial de anulación.{payment.mode==='account'?' Si la cuenta ya no tiene saldo suficiente para revertirlo, el sistema rechazará la operación.':''}</p>}
    {error&&<p role="alert" className="form-error">{error}</p>}
    <button className="primary-button form-submit" disabled={busy}>{busy?'Guardando…':action==='void'?'Confirmar eliminación':action==='move'?'Mover pago':'Guardar corrección'}</button>
  </form></SheetFrame>;
}

function CancelEditor({debt,payments,data,spaceId,onClose,onSaved}:{debt:Receivable;
  payments:ReceivablePayment[];data:FinanceData;spaceId:string;onClose:()=>void;onSaved:()=>Promise<void>}){
  const remaining=Math.max(0,Math.round((debt.principal-paidAmount(debt,payments))*currencyScale(debt.currency))/currencyScale(debt.currency));
  const [mode,setMode]=useState<'close_only'|'record_return'>('close_only');
  const [accountId,setAccountId]=useState(debt.sourceAccountId||data.accounts.find(a=>a.currency===debt.currency)?.id||'');
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const accounts=data.accounts.filter(account=>account.currency===debt.currency);
  const save=async(event:FormEvent)=>{
    event.preventDefault();
    if(mode==='record_return'&&(!confirmed||!accountId))return setError('Confirmá que recibiste el dinero y elegí la cuenta.');
    if(!supabase)return setError('Iniciá sesión para anular la deuda.');
    setBusy(true);setError('');
    try{await cancelReceivable(supabase,spaceId,debt.id,mode,mode==='record_return'?accountId:null);
      await onSaved();onClose()}
    catch(cause){setError(cause instanceof Error?cause.message:'No se pudo anular la deuda.')}
    finally{setBusy(false)}
  };
  return <SheetFrame title="Anular deuda" onClose={onClose}><form className="movement-form" onSubmit={save}>
    <p className="form-hint">{debt.person} · Pendiente: {formatMoney(remaining,debt.currency)}. El historial y los cobros anteriores se conservan.</p>
    {debt.debtType==='loan'&&remaining>0&&<label>¿Qué pasó con el capital pendiente?<select value={mode} onChange={event=>{setMode(event.target.value as typeof mode);setConfirmed(false)}}>
      <option value="close_only">No volvió: anular sin cambiar el saldo</option>
      <option value="record_return">Volvió realmente: registrar la devolución y anular</option>
    </select></label>}
    {mode==='record_return'&&<><p className="form-hint">Se registrará una sola entrada de {formatMoney(remaining,debt.currency)} como recuperación de capital. No será ganancia ni ingreso personal.</p>
      <label>Cuenta que recibió el dinero<select value={accountId} onChange={event=>setAccountId(event.target.value)} required>
        {accounts.map(account=><option key={account.id} value={account.id}>{account.currency} · {account.name}</option>)}
      </select></label>
      <label className="debt-cancel-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} required/>
        Confirmo que el dinero pendiente realmente volvió a esta cuenta.</label></>}
    {mode==='close_only'&&debt.debtType==='loan'&&<p className="form-hint">La salida del préstamo seguirá afectando el saldo. Anular no inventará una devolución.</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="primary-button form-submit" disabled={busy}>{busy?'Guardando…':'Confirmar anulación'}</button>
  </form></SheetFrame>;
}

export function DebtsPage({spaceId,userId,data,enabledCurrencies,onPaid}:{spaceId:string|null;userId:string|null;
  data:FinanceData;enabledCurrencies:Currency[];onPaid:()=>Promise<void>}){
  const [debts,setDebts]=useState<Receivable[]>([]);
  const [payments,setPayments]=useState<ReceivablePayment[]>([]);
  const [revisions,setRevisions]=useState<PaymentRevision[]>([]);
  const [correctionsReady,setCorrectionsReady]=useState(false);
  const [archiveReady,setArchiveReady]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [editor,setEditor]=useState<Receivable|null|undefined>(undefined);
  const [paying,setPaying]=useState<Receivable|null>(null);
  const [correcting,setCorrecting]=useState<{debt:Receivable;payment:ReceivablePayment;action:'edit'|'void'}|null>(null);
  const [cancelling,setCancelling]=useState<Receivable|null>(null);
  const [statusFilter,setStatusFilter]=useState<'all'|ReceivableState>('all');
  const [currencyFilter,setCurrencyFilter]=useState<'all'|Currency>('all');
  const [query,setQuery]=useState('');
  const refresh=useCallback(async()=>{
    if(!supabase||!spaceId||!userId)return;
    setLoading(true);
    try{const result=await loadReceivables(supabase,spaceId,userId);
      setDebts(result.debts);setPayments(result.payments);setRevisions(result.revisions);
      setCorrectionsReady(result.correctionsReady);setArchiveReady(result.archiveReady);setError('');}
    catch(cause){setError(/does not exist|could not find the table/i.test(String(cause))
      ?'La migración de Deudas por cobrar aún no está aplicada. Tus datos actuales siguen intactos.'
      :cause instanceof Error?cause.message:'No se pudieron cargar las deudas.');}
    finally{setLoading(false)}
  },[spaceId,userId]);
  useEffect(()=>{void refresh()},[refresh]);
  const activeDebts=debts.filter(debt=>!debt.archivedAt);
  const archivedDebts=debts.filter(debt=>Boolean(debt.archivedAt));
  const totals=useMemo(()=>CURRENCIES.map(currency=>({currency,total:debts.filter(debt=>!debt.archivedAt&&debt.currency===currency&&debt.status==='open')
    .reduce((sum,debt)=>sum+Math.max(0,Math.round((debt.principal-paidAmount(debt,payments))*currencyScale(currency))),0)/currencyScale(currency)}))
    .filter(item=>item.total>0),[debts,payments]);
  const visible=activeDebts.filter(debt=>{
    const state=receivableState(debt,payments);
    return (statusFilter==='all'||statusFilter===state)&&(currencyFilter==='all'||currencyFilter===debt.currency)
      &&`${debt.person} ${debt.description}`.toLocaleLowerCase('es-AR').includes(query.toLocaleLowerCase('es-AR'));
  });
  const activeGroups=groupReceivablesByPerson(visible,payments);
  const archivedGroups=groupReceivablesByPerson(archivedDebts,payments);
  const partialCount=activeDebts.filter(debt=>receivableState(debt,payments)==='partial').length;
  const paidCount=activeDebts.filter(debt=>receivableState(debt,payments)==='paid').length;
  const mutate=async(work:()=>Promise<void>)=>{
    try{await work();await refresh()}catch(cause){setError(cause instanceof Error?cause.message:'No se pudo guardar el cambio.')}
  };
  const renderDebtCard=(debt:Receivable,archived=false)=>{
    const paid=paidAmount(debt,payments);
    const remaining=Math.max(0,debt.principal-paid);
    const state=receivableState(debt,payments);
    const history=payments.filter(payment=>payment.receivableId===debt.id);
    const corrections=revisions.filter(item=>item.oldReceivableId===debt.id||item.newReceivableId===debt.id);
    const scale=currencyScale(debt.currency);
    let accumulated=0;
    const running=new Map<string,number>();
    for(const payment of [...history].sort((a,b)=>a.paidAt.localeCompare(b.paidAt))){
      if(payment.status!=='void')accumulated+=Math.round(payment.amount*scale);
      running.set(payment.id,accumulated/scale);
    }
    const progress=debtProgressPercent(debt,payments);
    return <details className="debt-card" key={debt.id}>
      <summary className="debt-card-summary">
        <div className="debt-card-head"><div><h3>{debt.description}</h3><p>{debt.debtType==='loan'?'Préstamo entregado':'Dinero por cobrar'} · {debt.currency}</p></div><span className={`debt-state ${state}`}>{states[state]}</span></div>
        <div className="debt-amounts"><div><span>Deuda original</span><strong>{formatMoney(debt.principal,debt.currency)}</strong></div>
          <div><span>Total pagado</span><strong>{formatMoney(paid,debt.currency)}</strong></div>
          <div><span>Saldo pendiente</span><strong>{formatMoney(remaining,debt.currency)}</strong></div></div>
        <div className="debt-progress" role="progressbar" aria-label={`Cobrado de ${debt.person}: ${debt.description}`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <span style={{width:`${progress}%`}}/></div>
        <span className="debt-expand-hint">Tocar para {archived?'ver el historial':'ver pagos y opciones'}</span>
      </summary>
      <div className="debt-card-detail">
        <small>Creada: {debt.createdOn}{debt.dueOn?` · Pago estimado: ${debt.dueOn}`:''}{debt.sourceAccountId?` · Cuenta: ${data.accounts.find(account=>account.id===debt.sourceAccountId)?.name||debt.sourceAccountId}`:''}</small>
        {debt.notes&&<p className="debt-notes">{debt.notes}</p>}
        {(history.length>0||corrections.length>0)&&<div className="debt-payment-history"><h4>Historial de pagos ({history.length})</h4>
          {history.map(payment=><div className="debt-payment-row" key={payment.id}>
            <p>{new Date(payment.paidAt).toLocaleDateString('es-AR')} · {payment.status==='void'?'Pago anulado':formatMoney(payment.amount,debt.currency)} · {payment.mode==='control'?'Solo control':`Recibido en ${data.accounts.find(account=>account.id===payment.accountId)?.name||payment.accountId}`}{payment.paymentReason==='cancellation_return'?' · capital devuelto al anular':payment.linkedExisting?' · movimiento vinculado':''}{payment.note?` · ${payment.note}`:''}
              {payment.status!=='void'&&<small> · Acumulado: {formatMoney(running.get(payment.id)||0,debt.currency)} · Pendiente: {formatMoney(Math.max(0,debt.principal-(running.get(payment.id)||0)),debt.currency)}</small>}</p>
            {!archived&&correctionsReady&&payment.status!=='void'&&payment.paymentReason==='collection'&&debt.status==='open'&&<div className="debt-payment-actions">
              <button type="button" className="text-link" onClick={()=>setCorrecting({debt,payment,action:'edit'})}>Editar pago</button>
              <button type="button" className="text-link" onClick={()=>setCorrecting({debt,payment,action:'void'})}>Eliminar pago</button>
            </div>}
          </div>)}
          {corrections.map(item=><p className="debt-payment-revision" key={item.id}>
            {new Date(item.changedAt).toLocaleString('es-AR')} · {item.action==='void'?'Pago anulado':item.action==='move'?'Pago trasladado':`Corrección: ${formatMoney(item.oldAmount,debt.currency)} → ${formatMoney(item.newAmount,debt.currency)}`}
            {item.action==='edit'&&item.oldMode!==item.newMode?` · ${item.oldMode==='account'?'En cuenta':'Solo control'} → ${item.newMode==='account'?'En cuenta':'Solo control'}`:''}
          </p>)}
        </div>}
        {!archived&&<div className="debt-actions">{(state==='pending'||state==='partial')&&correctionsReady?<button className="small-add" onClick={()=>setPaying(debt)}>Registrar pago</button>:null}
          {debt.cancellationMode!=='record_return'&&<button className="text-link" onClick={()=>setEditor(debt)}>Editar</button>}
          {state==='cancelled'&&debt.cancellationMode==='close_only'?<button className="text-link" onClick={()=>void mutate(()=>setReceivableStatus(supabase!,spaceId!,debt.id,'open'))}>Reabrir</button>
            :state!=='paid'&&state!=='cancelled'?<button className="text-link" onClick={()=>setCancelling(debt)}>Anular</button>:null}
          {debt.debtType==='owed'&&!history.length&&<button className="text-link" onClick={()=>{if(window.confirm(`¿Eliminar definitivamente la deuda de ${debt.person}?`))void mutate(()=>deleteReceivable(supabase!,spaceId!,debt.id))}}>Eliminar</button>}
          {state==='paid'&&archiveReady&&<button className="text-link" onClick={()=>{
            if(window.confirm('¿Quitar de la lista esta deuda pagada? Sus pagos y registros se conservarán.'))
              void mutate(()=>archivePaidReceivable(supabase!,spaceId!,debt.id));
          }}>Quitar de la lista</button>}
        </div>}
      </div>
    </details>;
  };
  const renderGroups=(groups:ReturnType<typeof groupReceivablesByPerson>,archived=false)=>groups.map(group=><details
    className="debt-person" key={group.key}>
    <summary><strong>{group.name}</strong><span>{group.debts.length} {group.debts.length===1?'deuda':'deudas'}</span>
      <span>{CURRENCIES.filter(currency=>(group.pendingByCurrency[currency]||0)>0)
        .map(currency=>`${currency}: ${formatMoney(group.pendingByCurrency[currency]||0,currency)}`).join(' · ')||'Sin saldo pendiente'}</span></summary>
    <div className="debt-list">{group.debts.map(debt=>renderDebtCard(debt,archived))}</div>
  </details>);
  if(!spaceId||!userId)return <section className="panel"><h2>Deudas por cobrar</h2><p>Iniciá sesión para registrar deudas personales.</p></section>;
  return <div className="debt-page">
    <div className="page-intro title-actions"><div><h1>Deudas por cobrar</h1><p>Préstamos entregados y dinero que te deben, con saldos reales separados.</p></div>
      <button className="primary-button" onClick={()=>setEditor(null)}><Plus size={18}/> Nueva deuda</button></div>
    <section className="panel"><div className="section-head"><h2>Pendiente por moneda</h2></div>
      <div className="debt-summary">{totals.length?totals.map(item=><div key={item.currency}><span>{item.currency}</span><strong>{formatMoney(item.total,item.currency)}</strong></div>):<p>No tenés cobros pendientes.</p>}</div>
      <p className="debt-summary-counts">{activeDebts.length} deudas · {partialCount} parcialmente cobradas · {paidCount} cobradas</p></section>
    <section className="panel"><div className="section-head"><h2>Mis deudas registradas</h2><span>{visible.length} resultados</span></div>
      <div className="debt-filters"><label className="search"><Search size={17}/><input aria-label="Buscar persona o concepto" placeholder="Buscar persona o concepto" value={query} onChange={event=>setQuery(event.target.value)}/></label>
        <select aria-label="Estado de deuda" value={statusFilter} onChange={event=>setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Todos los estados</option>{Object.entries(states).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="Moneda de deuda" value={currencyFilter} onChange={event=>setCurrencyFilter(event.target.value as typeof currencyFilter)}><option value="all">Todas las monedas</option>{CURRENCIES.map(currency=><option key={currency}>{currency}</option>)}</select></div>
      {loading&&<p className="form-hint">Consultando deudas…</p>}
      {error&&<p role="alert" className="form-error">{error}</p>}
      {!loading&&!correctionsReady&&!error&&<p className="form-hint">Para registrar y corregir pagos falta aplicar la migración de correcciones. Tus deudas existentes siguen visibles.</p>}
      <div className="debt-groups">{renderGroups(activeGroups)}</div>
      {!loading&&!error&&!visible.length&&<p className="form-hint">No hay deudas con estos filtros.</p>}
    </section>
    {archivedGroups.length>0&&<details className="panel debt-archive"><summary>Deudas archivadas ({archivedDebts.length})</summary>
      <p className="form-hint">Sus pagos y movimientos siguen conservados. No se mezclan con las deudas habituales.</p>
      <div className="debt-groups">{renderGroups(archivedGroups,true)}</div>
    </details>}
    {editor!==undefined&&<DebtEditor debt={editor} data={data} enabledCurrencies={enabledCurrencies} spaceId={spaceId} userId={userId}
      onClose={()=>setEditor(undefined)} onSaved={refresh} onLedgerChanged={onPaid}/>}
    {paying&&<PaymentEditor debt={paying} payments={payments} data={data} userId={userId} spaceId={spaceId}
      onClose={()=>setPaying(null)} onSaved={async()=>{await refresh();await onPaid()}}/>}
    {correcting&&<PaymentCorrectionEditor debt={correcting.debt} payment={correcting.payment} debts={debts}
      payments={payments} data={data} spaceId={spaceId} onClose={()=>setCorrecting(null)}
      initialAction={correcting.action} onSaved={async()=>{await refresh();await onPaid()}}/>}
    {cancelling&&<CancelEditor debt={cancelling} payments={payments} data={data} spaceId={spaceId}
      onClose={()=>setCancelling(null)} onSaved={async()=>{await refresh();await onPaid()}}/>}
  </div>;
}
