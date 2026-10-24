import React,{useLayoutEffect,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,Plus} from 'lucide-react';
import {accountBalance,Currency,dateISO,Entry,FinanceData,formatMoney,monthKey,monthLabel,shiftMonth} from './domain';
import {Empty,SheetFrame,sortedEntries} from './ui';
import {formatGiroMoneyEdit,formatGiroMoneyInput,giroMoneyInputError,parseGiroMoneyInput} from './giro-money';
import {giroMonthlyBalance} from './giro-accounting';

const today=new Date();
const receivedCurrency=(data:FinanceData,e:Entry)=>data.accounts.find(a=>a.id===e.toAccountId)?.currency||e.currency;

function GiroMoneyField({value,onChange,currency,required=false,placeholder}:{value:string;onChange:(value:string)=>void;currency:Currency;required?:boolean;placeholder?:string}) {
  const input=useRef<HTMLInputElement>(null);
  const nextCaret=useRef<number|null>(null);
  useLayoutEffect(()=>{
    const element=input.current;
    if(nextCaret.current!==null&&element===document.activeElement)
      element?.setSelectionRange(nextCaret.current,nextCaret.current);
    nextCaret.current=null;
  },[value]);
  const change=(event:React.ChangeEvent<HTMLInputElement>)=>{
    const raw=event.currentTarget.value;
    const position=event.currentTarget.selectionStart??raw.length;
    const native=event.nativeEvent as InputEvent;
    const edit=formatGiroMoneyEdit(raw,position,value,currency,native.inputType,native.data||'');
    if(!edit){event.currentTarget.value=value;event.currentTarget.setSelectionRange(Math.min(position,value.length),Math.min(position,value.length));return}
    if(edit.value===value){event.currentTarget.value=value;event.currentTarget.setSelectionRange(edit.caret,edit.caret);return}
    nextCaret.current=edit.caret;
    onChange(edit.value);
  };
  return <input ref={input} className="giro-money-input" type="text" inputMode="decimal" autoComplete="off" value={value} onChange={change} required={required} placeholder={placeholder}/>;
}

export function GiroSheet({data,entry,onClose,onSave}:{data:FinanceData;entry?:Entry|null;onClose:()=>void;onSave:(entry:Entry)=>Promise<string|null>}) {
  const [draftId]=useState(()=>crypto.randomUUID());
  const [fromId,setFromId]=useState(entry?.accountId||'BOB-transferencia');
  const [toId,setToId]=useState(entry?.toAccountId||'ARS-transferencia');
  const [amount,setAmount]=useState(entry?formatGiroMoneyInput(String(entry.amount).replace('.',','),entry.currency)||'':'');
  const [received,setReceived]=useState(entry?.received!==undefined?formatGiroMoneyInput(String(entry.received).replace('.',','),receivedCurrency(data,entry))||'':'');
  const [reference,setReference]=useState(entry?.giroReference||'');
  const [description,setDescription]=useState(entry?.description||'');
  const [date,setDate]=useState(entry?.date||dateISO(today));
  const [profitInput,setProfitInput]=useState(entry?.giroProfit!==undefined?formatGiroMoneyInput(String(entry.giroProfit).replace('.',','),entry.giroProfitCurrency||receivedCurrency(data,entry))||'':'');
  const profitCurrency=entry?.giroProfitCurrency||'ARS';
  const [error,setError]=useState('');
  const from=data.accounts.find(a=>a.id===fromId);const to=data.accounts.find(a=>a.id===toId);
  const moneyCurrency=to?.currency||'ARS';
  const price=parseGiroMoneyInput(received),given=parseGiroMoneyInput(amount);
  const profit=profitInput.trim()===''?undefined:parseGiroMoneyInput(profitInput);
  const save=async(event:React.FormEvent)=>{event.preventDefault();setError('');if(!from||!to)return setError('Elegí las cuentas del giro.');const moneyError=giroMoneyInputError(received,to.currency);if(moneyError)return setError(`Total cobrado: ${moneyError}`);const amountError=giroMoneyInputError(amount,from.currency);if(amountError)return setError(`Monto entregado: ${amountError}`);if(profitInput!==''){const profitError=giroMoneyInputError(profitInput,profitCurrency,true);if(profitError)return setError(`Ganancia incluida: ${profitError}`)}const result=await onSave({id:entry?.id||draftId,kind:'giro',scope:'giro',amount:given,currency:from.currency,accountId:from.id,toAccountId:to.id,received:price,giroReference:reference.trim()||undefined,giroProfit:profit,giroProfitCurrency:profit===undefined?undefined:profitCurrency,description:description.trim()||`Giro ${from.currency} → ${to.currency}`,date});if(result)setError(result)};
  return <SheetFrame title={entry?'Editar giro':'Nuevo giro'} onClose={onClose}><form className="giro-form" onSubmit={save}>
    <div className="giro-form-section"><strong>Datos del giro</strong><label>Referencia o cliente (opcional)<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Ej. Giro de Ana"/></label><label>Descripción (opcional)<input value={description} onChange={e=>setDescription(e.target.value)} placeholder="¿Para qué fue?"/></label><label>Fecha<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label></div>
    <div className="giro-form-section"><strong>Dinero que recibí</strong><label>Cuenta receptora<select value={toId} onChange={e=>setToId(e.target.value)}>{data.accounts.filter(a=>a.currency==='ARS'||a.id===entry?.toAccountId).map(a=><option key={a.id} value={a.id}>{a.currency} · {a.name}</option>)}</select></label><label>Total cobrado · {to?.currency}<GiroMoneyField value={received} onChange={setReceived} currency={moneyCurrency} required/></label></div>
    <div className="giro-form-section"><strong>Dinero que entregué</strong><label>Cuenta de origen<select value={fromId} onChange={e=>setFromId(e.target.value)}>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.currency} · {a.name} · {formatMoney(accountBalance(data,a.id),a.currency)}</option>)}</select></label><label>Monto entregado · {from?.currency}<GiroMoneyField value={amount} onChange={setAmount} currency={from?.currency||'BOB'} required/></label></div>
    <div className="giro-form-section"><strong>Ganancia declarada (opcional)</strong><label>Ganancia del giro · {profitCurrency}<GiroMoneyField value={profitInput} onChange={setProfitInput} currency={profitCurrency} placeholder="Dejar vacío si todavía no la conocés"/></label><small>Es el rendimiento que declarás para este giro. No se agrega a los saldos ni a tus ingresos personales.</small></div>
    <div className="giro-preview"><strong>Resumen del giro</strong><span>Cobrado al cliente <b>{formatMoney(price||0,to?.currency||'ARS')}</b></span><span>Entregado <b>{formatMoney(given||0,from?.currency||'BOB')}</b></span>{profit!==undefined&&<span>Ganancia declarada <b>{formatMoney(profit,profitCurrency)}</b></span>}<small>Lo cobrado no se contabiliza como sueldo. Los saldos cambian solo por el giro original.</small></div>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="giro-form-actions"><button type="button" className="small-add" onClick={onClose}>Cancelar</button><button className="primary-button form-submit">Guardar giro</button></div>
  </form></SheetFrame>;
}

export function Giros({data,onNew,onEdit,onDelete}:{data:FinanceData;onNew:()=>void;onEdit:(entry:Entry)=>void;onDelete:(entry:Entry)=>void}) {
  const [month,setMonth]=useState(monthKey(today));
  const entries=sortedEntries(data.entries.filter(e=>e.kind==='giro'&&e.date.slice(0,7)===month));
  const balance=giroMonthlyBalance(data,month);
  return <><div className="page-intro title-actions giro-title-actions"><div><h1>Giros de dinero</h1><p>Lo cobrado entra y lo entregado sale de sus cuentas generales.</p></div><button className="primary-button" onClick={onNew}><Plus size={18}/> Nuevo giro</button></div><div className="filter-row giro-filter"><div className="month-switch"><button aria-label="Mes anterior de giros" onClick={()=>setMonth(monthKey(shiftMonth(new Date(`${month}-01T12:00:00`),-1)))}><ChevronLeft size={16}/></button><span>{monthLabel(new Date(`${month}-01T12:00:00`))}</span><button aria-label="Mes siguiente de giros" disabled={month>=monthKey(today)} onClick={()=>setMonth(monthKey(shiftMonth(new Date(`${month}-01T12:00:00`),1)))}><ChevronRight size={16}/></button></div></div>
    <section className="panel giro-monthly"><h2>Balance de giros</h2><div className="giro-metrics"><div><span>Ganancia total declarada · ARS</span><strong>{formatMoney(balance.profitArs,'ARS')}</strong></div><div><span>Giros realizados</span><strong>{balance.count}</strong></div></div></section>
    <section className="panel giro-history">
      <div className="section-head"><div><h2>Giros registrados</h2><p>Cada giro también aparece una sola vez en Movimientos.</p></div></div>
      {entries.length?entries.map(e=>{
        const currency=receivedCurrency(data,e);
        return <div className="giro-row" key={e.id}>
          <div><strong>{e.giroReference||e.description}</strong><small>{e.date}</small></div>
          <div className="giro-row-values">
            <span>Recibido en {currency} <b>{formatMoney(e.received||0,currency)}</b></span>
            <span>Entregado en {e.currency} <b>{formatMoney(e.amount,e.currency)}</b></span>
            <span>Ganancia declarada · {e.giroProfitCurrency||'ARS'} <b>{e.giroProfit!==undefined?formatMoney(e.giroProfit,e.giroProfitCurrency||'ARS'):'Sin declarar'}</b></span>
          </div>
          <div className="giro-actions">
            <button className="text-link" onClick={()=>onEdit(e)}>Editar</button><button className="row-delete" onClick={()=>onDelete(e)}>Eliminar</button>
          </div>
        </div>;
      }):<Empty text="Todavía no hay giros en este mes."/>}
    </section></>;
}
