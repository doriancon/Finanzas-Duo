import React,{useLayoutEffect,useRef,useState} from 'react';
import {ArrowRight,ChevronLeft,ChevronRight,Plus} from 'lucide-react';
import {accountBalance,CURRENCIES,Currency,dateISO,Entry,FinanceData,formatMoney,monthKey,monthLabel,roundMoney,shiftMonth} from './domain';
import {Empty,SheetFrame,sortedEntries} from './ui';
import {formatGiroMoneyEdit,formatGiroMoneyInput,giroMoneyInputError,parseGiroMoneyInput} from './giro-money';
import {giroCapitalPending,giroDocumentedCost,giroMonthlyBalance} from './giro-accounting';
import type {GiroLink,GiroResult} from './domain';

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
  const [profitCurrency,setProfitCurrency]=useState<Currency>(entry?.giroProfitCurrency||data.accounts.find(a=>a.id===entry?.toAccountId)?.currency||'ARS');
  const [error,setError]=useState('');
  const from=data.accounts.find(a=>a.id===fromId);const to=data.accounts.find(a=>a.id===toId);
  const moneyCurrency=to?.currency||'ARS';
  const price=parseGiroMoneyInput(received),given=parseGiroMoneyInput(amount);
  const profit=profitInput.trim()===''?undefined:parseGiroMoneyInput(profitInput);
  const save=async(event:React.FormEvent)=>{event.preventDefault();setError('');if(!from||!to)return setError('Elegí las cuentas del giro.');const moneyError=giroMoneyInputError(received,to.currency);if(moneyError)return setError(`Total cobrado: ${moneyError}`);const amountError=giroMoneyInputError(amount,from.currency);if(amountError)return setError(`Monto entregado: ${amountError}`);if(profitInput!==''){const profitError=giroMoneyInputError(profitInput,profitCurrency,true);if(profitError)return setError(`Ganancia incluida: ${profitError}`)}const result=await onSave({id:entry?.id||draftId,kind:'giro',scope:'giro',amount:given,currency:from.currency,accountId:from.id,toAccountId:to.id,received:price,giroReference:reference.trim()||undefined,giroProfit:profit,giroProfitCurrency:profit===undefined?undefined:profitCurrency,description:description.trim()||`Giro ${from.currency} → ${to.currency}`,date});if(result)setError(result)};
  return <SheetFrame title={entry?'Editar giro':'Nuevo giro'} onClose={onClose}><form className="giro-form" onSubmit={save}>
    <div className="giro-form-section"><strong>Datos del giro</strong><label>Referencia o cliente (opcional)<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Ej. Giro de Ana"/></label><label>Descripción (opcional)<input value={description} onChange={e=>setDescription(e.target.value)} placeholder="¿Para qué fue?"/></label><label>Fecha<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label></div>
    <div className="giro-form-section"><strong>Dinero que recibí</strong><label>Cuenta receptora<select value={toId} onChange={e=>setToId(e.target.value)}>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.currency} · {a.name}</option>)}</select></label><label>Total cobrado · {to?.currency}<GiroMoneyField value={received} onChange={setReceived} currency={moneyCurrency} required/></label></div>
    <div className="giro-form-section"><strong>Dinero que entregué</strong><label>Cuenta de origen<select value={fromId} onChange={e=>setFromId(e.target.value)}>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.currency} · {a.name} · {formatMoney(accountBalance(data,a.id),a.currency)}</option>)}</select></label><label>Monto entregado · {from?.currency}<GiroMoneyField value={amount} onChange={setAmount} currency={from?.currency||'BOB'} required/></label></div>
    <div className="giro-form-section"><strong>Ganancia estimada (opcional)</strong><label>¿Cuánto estimás ganar?<GiroMoneyField value={profitInput} onChange={setProfitInput} currency={profitCurrency} placeholder="Dejar vacío si no la conocés"/></label><label>Moneda de la estimación<select value={profitCurrency} onChange={e=>setProfitCurrency(e.target.value as Currency)}>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></label><small>Esta cifra es orientativa. La ganancia neta se confirma con un costo comprobado y no modifica saldos.</small></div>
    <div className="giro-preview"><strong>Resumen del giro</strong><span>Cobrado al cliente <b>{formatMoney(price||0,to?.currency||'ARS')}</b></span><span>Entregado <b>{formatMoney(given||0,from?.currency||'BOB')}</b></span>{profit!==undefined&&<span>Ganancia estimada <b>{formatMoney(profit,profitCurrency)}</b></span>}<small>Lo cobrado no se contabiliza como ganancia personal. Los saldos cambian solo por el giro original.</small></div>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="giro-form-actions"><button type="button" className="small-add" onClick={onClose}>Cancelar</button><button className="primary-button form-submit">Guardar giro</button></div>
  </form></SheetFrame>;
}

export function GiroLinkSheet({data,giro,onClose,onSave}:{data:FinanceData;giro:Entry;onClose:()=>void;onSave:(link:GiroLink)=>Promise<string|null>}) {
  const changes=data.entries.filter(e=>e.kind==='transfer'&&data.accounts.find(a=>a.id===e.toAccountId)?.currency!==e.currency);
  const [transferId,setTransferId]=useState(changes[0]?.id||'');
  const [fromInput,setFromInput]=useState('');
  const [error,setError]=useState('');
  const transfer=changes.find(e=>e.id===transferId);
  const target=transfer?receivedCurrency(data,transfer):'ARS';
  const assigned=data.giroLinks.filter(l=>l.transferId===transferId).reduce((sum,l)=>sum+l.fromAmount,0);
  const available=transfer?roundMoney(transfer.amount-assigned,transfer.currency):0;
  const from=parseGiroMoneyInput(fromInput);
  const to=transfer?.received&&transfer.amount?roundMoney(transfer.received*from/transfer.amount,target):0;
  return <SheetFrame title="Vincular cambio con giro" onClose={onClose}><form className="giro-form" onSubmit={async e=>{e.preventDefault();if(!transfer)return;const result=await onSave({id:crypto.randomUUID(),giroId:giro.id,transferId,fromAmount:from,toAmount:to});if(result)setError(result)}}>
    <p className="form-hint">Elegí un cambio ya registrado en Mover dinero. Asignar una parte no crea otro movimiento ni cambia los saldos.</p>
    <label>Cambio de moneda<select value={transferId} onChange={e=>{setTransferId(e.target.value);setFromInput('')}}>{changes.map(e=><option key={e.id} value={e.id}>{e.date} · {formatMoney(e.amount,e.currency)} → {formatMoney(e.received||0,receivedCurrency(data,e))} · {e.description}</option>)}</select></label>
    {transfer?<><label>Parte entregada · {transfer.currency}<GiroMoneyField value={fromInput} onChange={setFromInput} currency={transfer.currency} required/></label><small>Disponible para asignar: {formatMoney(available,transfer.currency)}</small><div className="giro-preview"><span>Parte recibida correspondiente <b>{formatMoney(to,target)}</b></span></div></>:<p className="form-hint">Primero registrá el cambio con Mover dinero.</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}<button className="primary-button form-submit" disabled={!transfer}>Vincular cambio</button>
  </form></SheetFrame>;
}

export function GiroResultSheet({data,giro,onClose,onSave}:{data:FinanceData;giro:Entry;onClose:()=>void;onSave:(result:GiroResult)=>Promise<string|null>}) {
  const documented=giroDocumentedCost(data,giro);
  const [cost,setCost]=useState(documented===null?'':String(documented));
  const [fees,setFees]=useState('0');
  const [evidence,setEvidence]=useState('');
  const [error,setError]=useState('');
  const costNumber=parseGiroMoneyInput(cost),feesNumber=parseGiroMoneyInput(fees);
  const net=roundMoney((giro.received||0)-costNumber-feesNumber,'ARS');
  return <SheetFrame title="Confirmar resultado del giro" onClose={onClose}><form className="giro-form" onSubmit={async e=>{e.preventDefault();if(!cost.trim()||giroMoneyInputError(cost,'ARS',true)||giroMoneyInputError(fees,'ARS',true)||evidence.trim().length<8){setError('Indicá costo, comisiones y una referencia comprobable de al menos 8 caracteres.');return}const result=await onSave({giroId:giro.id,costArs:costNumber,feesArs:feesNumber,profitArs:net,evidence:evidence.trim(),confirmedAt:new Date().toISOString(),recognizedMonth:monthKey(new Date())});if(result)setError(result)}}>
    <p className="form-hint">El costo puede provenir de cambios vinculados o de otro comprobante. No necesitás reponer el capital para confirmar, pero sí conocer su costo real. La ganancia se registra en el mes de confirmación y no altera saldos.</p>
    {documented!==null&&<p className="form-hint">Costo trazado por cambios vinculados: {formatMoney(documented,'ARS')}.</p>}
    <label>Costo comprobado · ARS<GiroMoneyField value={cost} onChange={setCost} currency="ARS" required/></label>
    <label>Comisiones externas · ARS<GiroMoneyField value={fees} onChange={setFees} currency="ARS" required/></label>
    <label>Referencia del comprobante<input value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="Ej. cambio del 24/10, recibo..." required/></label>
    <div className="giro-preview"><span>Cobrado <b>{formatMoney(giro.received||0,'ARS')}</b></span><span>Costo y comisiones <b>{formatMoney(costNumber+feesNumber,'ARS')}</b></span><span>Resultado neto <b>{formatMoney(net,'ARS')}</b></span></div>
    {error&&<p className="form-error" role="alert">{error}</p>}<button className="primary-button form-submit" disabled={!cost.trim()||costNumber<=0}>Confirmar ganancia</button>
  </form></SheetFrame>;
}

export function Giros({data,onNew,onEdit,onDelete,onLink,onUnlink,onConfirm,onMove}:{data:FinanceData;onNew:()=>void;onEdit:(entry:Entry)=>void;onDelete:(entry:Entry)=>void;onLink:(entry:Entry)=>void;onUnlink:(link:GiroLink)=>void;onConfirm:(entry:Entry)=>void;onMove:()=>void}) {
  const [month,setMonth]=useState(monthKey(today));
  const entries=sortedEntries(data.entries.filter(e=>e.kind==='giro'&&e.date.slice(0,7)===month));
  const balance=giroMonthlyBalance(data,month);
  return <><div className="page-intro title-actions giro-title-actions"><div><h1>Giros de dinero</h1><p>Lo cobrado entra y lo entregado sale de sus cuentas generales.</p></div><button className="primary-button" onClick={onNew}><Plus size={18}/> Nuevo giro</button></div><div className="filter-row giro-filter"><div className="month-switch"><button aria-label="Mes anterior de giros" onClick={()=>setMonth(monthKey(shiftMonth(new Date(`${month}-01T12:00:00`),-1)))}><ChevronLeft size={16}/></button><span>{monthLabel(new Date(`${month}-01T12:00:00`))}</span><button aria-label="Mes siguiente de giros" disabled={month>=monthKey(today)} onClick={()=>setMonth(monthKey(shiftMonth(new Date(`${month}-01T12:00:00`),1)))}><ChevronRight size={16}/></button></div></div>
    <section className="panel giro-monthly"><h2>Balance de giros</h2><div className="giro-metrics"><div><span>Ganancia neta confirmada</span><strong>{formatMoney(balance.profitArs,'ARS')}</strong><small>Registrada en este mes</small></div><div><span>Giros realizados</span><strong>{balance.count}</strong></div><div><span>Ganancias pendientes</span><strong>{balance.pending}</strong></div></div><div className="giro-capital"><span>Capital pendiente de reponer</span><div>{balance.capital.filter(x=>x.amount>0).map(x=><strong key={x.currency}>{formatMoney(x.amount,x.currency)}</strong>)}{balance.capital.every(x=>x.amount===0)&&<strong>Sin capital pendiente</strong>}</div></div></section>
    <section className="panel giro-history"><div className="section-head"><div><h2>Giros registrados</h2><p>Cada giro también aparece una sola vez en Movimientos.</p></div></div>{entries.length?entries.map(e=>{const result=data.giroResults.find(r=>r.giroId===e.id);const currency=receivedCurrency(data,e);const estimate=e.giroProfit;const links=data.giroLinks.filter(l=>l.giroId===e.id);return <div className="giro-row" key={e.id}><div><strong>{e.giroReference||e.description}</strong><small>{e.date} · {result?'Confirmada':estimate!==undefined?'Estimada':'Pendiente'}</small></div><div className="giro-row-values"><span>Recibido <b>{formatMoney(e.received||0,currency)}</b></span><span>Entregado <b>{formatMoney(e.amount,e.currency)}</b></span><span>Ganancia individual <b>{result?formatMoney(result.profitArs,'ARS'):estimate!==undefined?`${formatMoney(estimate,e.giroProfitCurrency||currency)} estimada`:'Ganancia pendiente'}</b></span><span>Capital por reponer <b>{formatMoney(giroCapitalPending(data,e),e.currency)}</b></span>{links.map(link=>{const transfer=data.entries.find(x=>x.id===link.transferId);return <span key={link.id}>Cambio vinculado <b>{transfer?`${formatMoney(link.fromAmount,transfer.currency)} → ${formatMoney(link.toAmount,receivedCurrency(data,transfer))}`:link.transferId}</b>{!result&&<button className="text-link" onClick={()=>onUnlink(link)}>Quitar vínculo</button>}</span>})}</div><div className="giro-actions">{data.giroAccountingReady&&<><button className="text-link" onClick={()=>onLink(e)}>{result?"Registrar reposición":"Vincular cambio"}</button>{!result&&currency==='ARS'&&<button className="text-link" onClick={()=>onConfirm(e)}>Confirmar</button>}</>}{result&&<details><summary>Ver cálculo</summary><small>Cobrado {formatMoney(e.received||0,'ARS')} − costo {formatMoney(result.costArs,'ARS')} − comisiones {formatMoney(result.feesArs,'ARS')} = {formatMoney(result.profitArs,'ARS')}. {result.evidence}. {links.length} cambios vinculados.</small></details>}{!result&&<><button className="text-link" onClick={()=>onEdit(e)}>Editar <ArrowRight size={13}/></button><button className="row-delete" onClick={()=>onDelete(e)}>Eliminar</button></>}</div></div>}):<Empty text="Todavía no hay giros en este mes."/>}{data.giroAccountingReady&&<button className="text-link" onClick={onMove}>Registrar cambio con Mover dinero <ArrowRight size={13}/></button>}{!data.giroAccountingReady&&<p className="form-hint">Los vínculos estarán disponibles al aplicar la migración de Giros.</p>}</section></>;
}
