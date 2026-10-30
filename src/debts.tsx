import {useCallback,useEffect,useMemo,useState} from 'react';
import type {FormEvent} from 'react';
import {Plus,Search} from 'lucide-react';
import type {Currency,FinanceData} from './domain';
import {accountBalance,CURRENCIES,currencyScale,dateISO,formatMoney} from './domain';
import {MoneyField,moneyText,moneyTextError,parseMoneyText} from './money-field';
import {SheetFrame} from './ui';
import {supabase} from './supabase';
import {cancelReceivable,createReceivableLoan,deleteReceivable,loadReceivables,paidAmount,receivableState,recordReceivablePayment,
  saveReceivable,setReceivableStatus,type Receivable,type ReceivablePayment,type ReceivableState} from './debts-remote';

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
        cancellationMode:debt?.cancellationMode||null,
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
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [paymentId]=useState(()=>crypto.randomUUID());
  const accounts=data.accounts.filter(account=>account.currency===debt.currency);
  const linkedIds=new Set(payments.map(payment=>payment.entryId));
  const existing=data.entries.filter(entry=>entry.kind==='income'&&entry.scope!=='receivable'
    &&entry.currency===debt.currency&&entry.actorUserId===userId&&entry.amount<=remaining&&!linkedIds.has(entry.id));
  const selected=existing.find(entry=>entry.id===existingId);
  const save=async(event:FormEvent)=>{
    event.preventDefault();
    const value=selected?selected.amount:parseMoneyText(amount);
    if(!selected){const problem=moneyTextError(amount,debt.currency);if(problem)return setError(problem)}
    if(value>remaining)return setError('El cobro supera el saldo pendiente.');
    if(!supabase)return setError('Iniciá sesión para registrar el cobro.');
    setBusy(true);setError('');
    try{
      await recordReceivablePayment(supabase,spaceId,debt.id,paymentId,value,
        selected?.accountId||accountId,selected?.id||null);
      await onSaved();onClose();
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo registrar el cobro.')}
    finally{setBusy(false)}
  };
  return <SheetFrame title="Registrar pago" onClose={onClose}><form className="movement-form" onSubmit={save}>
    <div className="goal-preview"><span>{debt.person} · {debt.currency}</span><strong>{formatMoney(remaining,debt.currency)} pendientes</strong></div>
    <p className="form-hint">Podés registrar cualquier pago parcial hasta completar el saldo pendiente.</p>
    <label>¿Ya registraste este cobro en Movimientos?<select value={existingId} onChange={event=>setExistingId(event.target.value)}>
      <option value="">No; agregar el cobro a la cuenta elegida</option>
      {existing.map(entry=><option key={entry.id} value={entry.id}>{entry.date} · {formatMoney(entry.amount,entry.currency)} · {entry.description}</option>)}
    </select></label>
    {selected?<p className="form-hint">{debt.debtType==='loan'
      ?'Se vinculará el ingreso existente y se clasificará como devolución de préstamo. No cambia el importe ni el saldo; dejará de contar como ingreso personal.'
      :'Se vinculará el ingreso existente. No se creará otro movimiento ni cambiará el saldo.'}</p>:<>
      <label>Importe recibido<MoneyField value={amount} onChange={setAmount} currency={debt.currency} required/></label>
      <label>Cuenta receptora<select value={accountId} onChange={event=>setAccountId(event.target.value)} required>
        {accounts.map(account=><option key={account.id} value={account.id}>{account.currency} · {account.name}</option>)}
      </select></label>
      <p className="form-hint">Solo al guardar este cobro se sumará el importe a la cuenta. {debt.debtType==='loan'?'Recuperar capital no es ganancia ni ingreso personal.':'No entra en ingresos personales.'}</p>
    </>}
    {error&&<p role="alert" className="form-error">{error}</p>}
    <button className="primary-button form-submit" disabled={busy||(!selected&&!accountId)}>{busy?'Guardando…':'Registrar pago'}</button>
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
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [editor,setEditor]=useState<Receivable|null|undefined>(undefined);
  const [paying,setPaying]=useState<Receivable|null>(null);
  const [cancelling,setCancelling]=useState<Receivable|null>(null);
  const [statusFilter,setStatusFilter]=useState<'all'|ReceivableState>('all');
  const [currencyFilter,setCurrencyFilter]=useState<'all'|Currency>('all');
  const [query,setQuery]=useState('');
  const refresh=useCallback(async()=>{
    if(!supabase||!spaceId||!userId)return;
    setLoading(true);
    try{const result=await loadReceivables(supabase,spaceId,userId);
      setDebts(result.debts);setPayments(result.payments);setError('');}
    catch(cause){setError(/does not exist|could not find the table/i.test(String(cause))
      ?'La migración de Deudas por cobrar aún no está aplicada. Tus datos actuales siguen intactos.'
      :cause instanceof Error?cause.message:'No se pudieron cargar las deudas.');}
    finally{setLoading(false)}
  },[spaceId,userId]);
  useEffect(()=>{void refresh()},[refresh]);
  const totals=useMemo(()=>CURRENCIES.map(currency=>({currency,total:debts.filter(debt=>debt.currency===currency&&debt.status==='open')
    .reduce((sum,debt)=>sum+Math.max(0,Math.round((debt.principal-paidAmount(debt,payments))*currencyScale(currency))),0)/currencyScale(currency)}))
    .filter(item=>item.total>0),[debts,payments]);
  const visible=debts.filter(debt=>{
    const state=receivableState(debt,payments);
    return (statusFilter==='all'||statusFilter===state)&&(currencyFilter==='all'||currencyFilter===debt.currency)
      &&`${debt.person} ${debt.description}`.toLocaleLowerCase('es-AR').includes(query.toLocaleLowerCase('es-AR'));
  });
  const mutate=async(work:()=>Promise<void>)=>{
    try{await work();await refresh()}catch(cause){setError(cause instanceof Error?cause.message:'No se pudo guardar el cambio.')}
  };
  if(!spaceId||!userId)return <section className="panel"><h2>Deudas por cobrar</h2><p>Iniciá sesión para registrar deudas personales.</p></section>;
  return <div className="debt-page">
    <div className="page-intro title-actions"><div><h1>Deudas por cobrar</h1><p>Préstamos entregados y dinero que te deben, con saldos reales separados.</p></div>
      <button className="primary-button" onClick={()=>setEditor(null)}><Plus size={18}/> Nueva deuda</button></div>
    <section className="panel"><div className="section-head"><h2>Pendiente por moneda</h2></div>
      <div className="debt-summary">{totals.length?totals.map(item=><div key={item.currency}><span>{item.currency}</span><strong>{formatMoney(item.total,item.currency)}</strong></div>):<p>No tenés cobros pendientes.</p>}</div></section>
    <section className="panel"><div className="section-head"><h2>Mis deudas registradas</h2><span>{visible.length} resultados</span></div>
      <div className="debt-filters"><label className="search"><Search size={17}/><input aria-label="Buscar persona o concepto" placeholder="Buscar persona o concepto" value={query} onChange={event=>setQuery(event.target.value)}/></label>
        <select aria-label="Estado de deuda" value={statusFilter} onChange={event=>setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Todos los estados</option>{Object.entries(states).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="Moneda de deuda" value={currencyFilter} onChange={event=>setCurrencyFilter(event.target.value as typeof currencyFilter)}><option value="all">Todas las monedas</option>{CURRENCIES.map(currency=><option key={currency}>{currency}</option>)}</select></div>
      {loading&&<p className="form-hint">Consultando deudas…</p>}
      {error&&<p role="alert" className="form-error">{error}</p>}
      <div className="debt-list">{visible.map(debt=>{
        const paid=paidAmount(debt,payments);
        const remaining=Math.max(0,debt.principal-paid);
        const state=receivableState(debt,payments);
        const history=payments.filter(payment=>payment.receivableId===debt.id);
        return <article className="debt-card" key={debt.id}>
          <div className="debt-card-head"><div><h3>{debt.person}</h3><p>{debt.description} · {debt.debtType==='loan'?'Préstamo entregado':'Dinero por cobrar'}</p></div><span className={`debt-state ${state}`}>{states[state]}</span></div>
          <div className="debt-amounts"><div><span>Deuda original</span><strong>{formatMoney(debt.principal,debt.currency)}</strong></div>
            <div><span>Total pagado</span><strong>{formatMoney(paid,debt.currency)}</strong></div>
            <div><span>Saldo pendiente</span><strong>{formatMoney(remaining,debt.currency)}</strong></div></div>
          <div className="debt-progress" role="progressbar" aria-label={`Cobrado de ${debt.person}`} aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.min(100,Math.round(paid/debt.principal*100))}><span style={{width:`${Math.min(100,paid/debt.principal*100)}%`}}/></div>
          <small>Creada: {debt.createdOn}{debt.dueOn?` · Pago estimado: ${debt.dueOn}`:''}{debt.sourceAccountId?` · Cuenta: ${data.accounts.find(account=>account.id===debt.sourceAccountId)?.name||debt.sourceAccountId}`:''}</small>
          {debt.notes&&<p className="debt-notes">{debt.notes}</p>}
          {history.length>0&&<details><summary>Historial de pagos ({history.length})</summary>
            {history.map(payment=><p key={payment.id}>{new Date(payment.paidAt).toLocaleDateString('es-AR')} · {formatMoney(payment.amount,debt.currency)} · {data.accounts.find(account=>account.id===payment.accountId)?.name||payment.accountId}{payment.paymentReason==='cancellation_return'?' · capital devuelto al anular':payment.linkedExisting?' · movimiento vinculado':''}</p>)}
          </details>}
          <div className="debt-actions">{state==='pending'||state==='partial'?<button className="small-add" onClick={()=>setPaying(debt)}>Registrar pago</button>:null}
            {debt.cancellationMode!=='record_return'&&<button className="text-link" onClick={()=>setEditor(debt)}>Editar</button>}
            {state==='cancelled'&&debt.cancellationMode==='close_only'?<button className="text-link" onClick={()=>void mutate(()=>setReceivableStatus(supabase!,spaceId,debt.id,'open'))}>Reabrir</button>
              :state!=='paid'&&state!=='cancelled'?<button className="text-link" onClick={()=>setCancelling(debt)}>Anular</button>:null}
            {debt.debtType==='owed'&&!history.length&&<button className="text-link" onClick={()=>{if(window.confirm(`¿Eliminar definitivamente la deuda de ${debt.person}?`))void mutate(()=>deleteReceivable(supabase!,spaceId,debt.id))}}>Eliminar</button>}
          </div>
        </article>;
      })}</div>
      {!loading&&!error&&!visible.length&&<p className="form-hint">No hay deudas con estos filtros.</p>}
    </section>
    {editor!==undefined&&<DebtEditor debt={editor} data={data} enabledCurrencies={enabledCurrencies} spaceId={spaceId} userId={userId}
      onClose={()=>setEditor(undefined)} onSaved={refresh} onLedgerChanged={onPaid}/>}
    {paying&&<PaymentEditor debt={paying} payments={payments} data={data} userId={userId} spaceId={spaceId}
      onClose={()=>setPaying(null)} onSaved={async()=>{await refresh();await onPaid()}}/>}
    {cancelling&&<CancelEditor debt={cancelling} payments={payments} data={data} spaceId={spaceId}
      onClose={()=>setCancelling(null)} onSaved={async()=>{await refresh();await onPaid()}}/>}
  </div>;
}
