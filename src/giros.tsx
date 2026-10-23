import React,{useState} from 'react';
import {ArrowRight,ChevronLeft,ChevronRight,Plus} from 'lucide-react';
import {accountBalance,CURRENCIES,Currency,dateISO,Entry,FinanceData,formatMoney,monthKey,monthLabel,roundMoney,shiftMonth} from './domain';
import {Empty,SheetFrame,sortedEntries} from './ui';

const today=new Date();
const receivedCurrency=(data:FinanceData,e:Entry)=>data.accounts.find(a=>a.id===e.toAccountId)?.currency||e.currency;

export function GiroSheet({data,entry,onClose,onSave}:{data:FinanceData;entry?:Entry|null;onClose:()=>void;onSave:(entry:Entry)=>string|null}) {
  const [fromId,setFromId]=useState(entry?.accountId||'BOB-transferencia');
  const [toId,setToId]=useState(entry?.toAccountId||'ARS-transferencia');
  const [amount,setAmount]=useState(entry?String(entry.amount):'');
  const [received,setReceived]=useState(entry?.received!==undefined?String(entry.received):'');
  const [reference,setReference]=useState(entry?.giroReference||'');
  const [description,setDescription]=useState(entry?.description||'');
  const [date,setDate]=useState(entry?.date||dateISO(today));
  const [profitInput,setProfitInput]=useState(entry?.giroProfit!==undefined?String(entry.giroProfit):'');
  const [profitCurrency,setProfitCurrency]=useState<Currency>(entry?.giroProfitCurrency||data.accounts.find(a=>a.id===entry?.toAccountId)?.currency||'ARS');
  const [error,setError]=useState('');
  const from=data.accounts.find(a=>a.id===fromId);const to=data.accounts.find(a=>a.id===toId);
  const moneyCurrency=to?.currency||'ARS';
  const price=roundMoney(Number(received),moneyCurrency),given=roundMoney(Number(amount),from?.currency||'BOB');
  const profit=profitInput.trim()===''?undefined:roundMoney(Number(profitInput),profitCurrency);
  const save=(event:React.FormEvent)=>{event.preventDefault();setError('');if(!from||!to)return setError('Elegí las cuentas del giro.');const result=onSave({id:entry?.id||crypto.randomUUID(),kind:'giro',scope:'giro',amount:given,currency:from.currency,accountId:from.id,toAccountId:to.id,received:price,giroReference:reference.trim()||undefined,giroProfit:profit,giroProfitCurrency:profit===undefined?undefined:profitCurrency,description:description.trim()||`Giro ${from.currency} → ${to.currency}`,date});if(result)setError(result)};
  return <SheetFrame title={entry?'Editar giro':'Nuevo giro'} onClose={onClose}><form className="giro-form" onSubmit={save}>
    <div className="giro-form-section"><strong>Datos del giro</strong><label>Referencia o cliente (opcional)<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Ej. Giro de Ana"/></label><label>Descripción (opcional)<input value={description} onChange={e=>setDescription(e.target.value)} placeholder="¿Para qué fue?"/></label><label>Fecha<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label></div>
    <div className="giro-form-section"><strong>Dinero que recibí</strong><label>Cuenta receptora<select value={toId} onChange={e=>setToId(e.target.value)}>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.currency} · {a.name}</option>)}</select></label><label>Total cobrado · {to?.currency}<input type="number" inputMode="decimal" min="0.000001" step="any" value={received} onChange={e=>setReceived(e.target.value)} required/></label></div>
    <div className="giro-form-section"><strong>Dinero que entregué</strong><label>Cuenta de origen<select value={fromId} onChange={e=>setFromId(e.target.value)}>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.currency} · {a.name} · {formatMoney(accountBalance(data,a.id),a.currency)}</option>)}</select></label><label>Monto entregado · {from?.currency}<input type="number" inputMode="decimal" min="0.000001" step="any" value={amount} onChange={e=>setAmount(e.target.value)} required/></label></div>
    <div className="giro-form-section"><strong>Ganancia incluida (opcional)</strong><label>¿Cuánto ganaste en este giro?<input type="number" inputMode="decimal" min="0" step="any" value={profitInput} onChange={e=>setProfitInput(e.target.value)} placeholder="Dejar vacío si no la conocés"/></label><label>Moneda de la ganancia<select value={profitCurrency} onChange={e=>setProfitCurrency(e.target.value as Currency)}>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></label><small>La ganancia está dentro de lo cobrado; no modifica los saldos otra vez.</small></div>
    <div className="giro-preview"><strong>Resumen del giro</strong><span>Cobrado al cliente <b>{formatMoney(price||0,to?.currency||'ARS')}</b></span><span>Entregado <b>{formatMoney(given||0,from?.currency||'BOB')}</b></span>{profit!==undefined&&<><span>Ganancia incluida <b>{formatMoney(profit,profitCurrency)}</b></span>{profitCurrency===moneyCurrency?<span>Resto del cobro <b>{formatMoney(roundMoney(price-profit,moneyCurrency),moneyCurrency)}</b></span>:<small>El resto del cobro requiere expresar la ganancia en {moneyCurrency}. No se convierte automáticamente.</small>}</>}<small>La ganancia está incluida en lo cobrado y no se suma otra vez al saldo.</small></div>
    {error&&<p className="form-error" role="alert">{error}</p>}<button className="primary-button form-submit">Guardar giro</button>
  </form></SheetFrame>;
}

export function Giros({data,onNew,onEdit,onDelete}:{data:FinanceData;onNew:()=>void;onEdit:(entry:Entry)=>void;onDelete:(entry:Entry)=>void}) {
  const [month,setMonth]=useState(monthKey(today));
  const entries=sortedEntries(data.entries.filter(e=>e.kind==='giro'&&e.date.slice(0,7)===month));
  return <><div className="page-intro title-actions"><div><h1>Giros de dinero</h1><p>Lo cobrado entra y lo entregado sale de sus cuentas generales.</p></div><button className="primary-button" onClick={onNew}><Plus size={18}/> Nuevo giro</button></div><div className="filter-row giro-filter"><div className="month-switch"><button aria-label="Mes anterior de giros" onClick={()=>setMonth(monthKey(shiftMonth(new Date(`${month}-01T12:00:00`),-1)))}><ChevronLeft size={16}/></button><span>{monthLabel(new Date(`${month}-01T12:00:00`))}</span><button aria-label="Mes siguiente de giros" disabled={month>=monthKey(today)} onClick={()=>setMonth(monthKey(shiftMonth(new Date(`${month}-01T12:00:00`),1)))}><ChevronRight size={16}/></button></div></div><section className="panel giro-history"><div className="section-head"><div><h2>Giros registrados</h2><p>Cada giro también aparece una sola vez en Movimientos.</p></div></div>{entries.length?entries.map(e=><div className="giro-row" key={e.id}><div><strong>{e.giroReference||e.description}</strong><small>{e.date} · Completado</small></div><div className="giro-row-values"><span>Recibido <b>{formatMoney(e.received||0,receivedCurrency(data,e))}</b></span><span>Entregado <b>{formatMoney(e.amount,e.currency)}</b></span><span>Ganancia incluida <b>{e.giroProfit===undefined?'Sin indicar':formatMoney(e.giroProfit,e.giroProfitCurrency||receivedCurrency(data,e))}</b></span></div><div className="giro-actions"><button className="text-link" onClick={()=>onEdit(e)}>Editar <ArrowRight size={13}/></button><button className="row-delete" onClick={()=>onDelete(e)}>Eliminar</button></div></div>):<Empty text="Todavía no hay giros en este mes."/>}</section></>;
}
