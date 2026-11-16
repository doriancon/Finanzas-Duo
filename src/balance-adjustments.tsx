import {useRef,useState,type FormEvent} from 'react';
import {accountBalance,formatMoney,roundMoney,uniqueBalanceAdjustments,type FinanceData} from './domain';
import {MoneyField,moneyText,moneyTextError,parseMoneyText} from './money-field';
import {SheetFrame} from './ui';

export function BalanceAdjustmentsSheet({data,onClose,onSave}:{data:FinanceData;onClose:()=>void;
  onSave:(accountId:string,newBalance:number,expectedBalance:number,reason:string,requestId:string)=>Promise<string|null>}){
  const [accountId,setAccountId]=useState(data.accounts[0]?.id||'');
  const account=data.accounts.find(a=>a.id===accountId);
  const current=account?accountBalance(data,account.id):0;
  const [amount,setAmount]=useState('');
  const [reason,setReason]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const saving=useRef(false);
  const request=useRef<string|null>(null);
  const clearRequest=()=>{request.current=null;setError('')};
  const valid=account&&!moneyTextError(amount,account.currency,true);
  const next=valid?parseMoneyText(amount):null;
  const delta=next===null||!account?null:roundMoney(next-current,account.currency);
  const history=uniqueBalanceAdjustments(data.balanceAdjustments).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const save=async(event:FormEvent)=>{
    event.preventDefault();
    if(!account||saving.current)return;
    const problem=moneyTextError(amount,account.currency,true);
    if(problem){setError(problem);return}
    const value=parseMoneyText(amount);
    if(value===current){setError('El nuevo saldo ya coincide con el actual.');return}
    if(!window.confirm(`¿Confirmar el ajuste de ${account.currency} · ${account.name} de ${formatMoney(current,account.currency)} a ${formatMoney(value,account.currency)}? Tus movimientos anteriores se conservarán.`))return;
    request.current||=crypto.randomUUID();
    saving.current=true;setBusy(true);setError('');
    try{
      const failure=await onSave(account.id,value,current,reason.trim(),request.current);
      if(failure){setError(failure);return}
      request.current=null;setAmount('');setReason('');
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo guardar el ajuste.');}
    finally{saving.current=false;setBusy(false)}
  };
  return <SheetFrame title="Ajustar saldo" onClose={onClose}><div className="balance-adjustments">
    <p className="form-hint">Para cambiar dinero entre monedas, usá Mover dinero. Este ajuste corrige una diferencia real de una sola cuenta.</p>
    {!data.balanceAdjustmentsReady&&<p className="form-error" role="alert">Ajustar saldo estará disponible cuando se aplique la migración de ajustes en Supabase.</p>}
    <form className="movement-form" onSubmit={event=>void save(event)}>
      <label>Cuenta<select value={accountId} onChange={event=>{setAccountId(event.target.value);setAmount('');clearRequest()}}>
        {data.accounts.map(a=><option key={a.id} value={a.id}>{a.currency} · {a.name}</option>)}
      </select></label>
      {account&&<><div className="goal-preview"><span>Saldo actual · {account.currency} · {account.name}</span><strong>{formatMoney(current,account.currency)}</strong></div>
        <label>Nuevo saldo real<MoneyField value={amount} onChange={value=>{setAmount(value);clearRequest()}} currency={account.currency} required/></label>
        <button type="button" className="small-add" onClick={()=>{setAmount(moneyText(0,account.currency));clearRequest()}}>Dejar en cero</button>
        <p className="adjustment-difference">Diferencia: <strong>{delta===null?'—':formatMoney(delta,account.currency)}</strong></p>
        <label>Motivo (opcional)<input value={reason} maxLength={200} onChange={event=>{setReason(event.target.value);clearRequest()}} placeholder="Por ejemplo, diferencia al contar efectivo"/></label></>}
      <p className="form-hint">Este ajuste modificará tu saldo disponible, pero conservará todos tus movimientos anteriores.</p>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <button className="primary-button form-submit" disabled={busy||!account||!data.balanceAdjustmentsReady}>{busy?'Guardando…':'Confirmar ajuste'}</button>
    </form>
    <section className="adjustment-history"><h3>Historial de ajustes</h3>
      {history.length?history.map(item=>{const a=data.accounts.find(row=>row.id===item.accountId);return <article key={item.id}>
        <div><strong>{item.currency} · {a?.name||item.accountId}</strong><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('es-AR')}</time></div>
        <p>{formatMoney(item.previousBalance,item.currency)} → {formatMoney(item.newBalance,item.currency)} · Diferencia {formatMoney(item.delta,item.currency)}</p>
        <small>{item.actorName}{item.reason?` · ${item.reason}`:''}</small>
      </article>}):<p className="form-hint">Todavía no hay ajustes registrados.</p>}
    </section>
  </div></SheetFrame>;
}
