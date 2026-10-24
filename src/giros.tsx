import React,{useLayoutEffect,useRef,useState} from 'react';
import {ArrowRight,ChevronLeft,ChevronRight,Plus} from 'lucide-react';
import {accountBalance,CURRENCIES,Currency,dateISO,Entry,FinanceData,formatMoney,monthKey,monthLabel,roundMoney,shiftMonth} from './domain';
import {Empty,SheetFrame,sortedEntries} from './ui';
import {formatGiroMoneyEdit,formatGiroMoneyInput,giroMoneyInputError,parseGiroMoneyInput} from './giro-money';
import {availableGiroChanges,giroCapitalPending,giroMonthlyBalance,giroRecoveredCapital,validateGiroCashPlans} from './giro-accounting';
import type {GiroCashPlan,GiroLink} from './domain';

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

export function GiroLinkSheet({data,giro,onClose,onSave}:{data:FinanceData;giro:Entry;onClose:()=>void;onSave:(link:GiroLink)=>Promise<string|null>}) {
  const changes=availableGiroChanges(data).filter(e=>!data.giroLinks.some(l=>l.giroId===giro.id&&l.transferId===e.id));
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
    {changes.length>0&&<label>Cambio de moneda<select value={transferId} onChange={e=>{setTransferId(e.target.value);setFromInput('')}}>{changes.map(e=><option key={e.id} value={e.id}>{e.date} · {formatMoney(e.amount,e.currency)} → {formatMoney(e.received||0,receivedCurrency(data,e))} · {e.description}</option>)}</select></label>}
    {transfer?<><label>Parte entregada · {transfer.currency}<GiroMoneyField value={fromInput} onChange={setFromInput} currency={transfer.currency} required/></label><small>Disponible para asignar: {formatMoney(available,transfer.currency)}</small><div className="giro-preview"><span>Parte recibida correspondiente <b>{formatMoney(to,target)}</b></span></div></>:<p className="form-hint">No hay cambios disponibles para este giro. Podés registrarlos con Mover dinero y vincularlos después.</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}<button className="primary-button form-submit" disabled={!transfer}>Vincular cambio</button>
  </form></SheetFrame>;
}

export function GiroCashPlanSheet({data,giro,onClose,onSave}:{data:FinanceData;giro:Entry;onClose:()=>void;onSave:(plans:GiroCashPlan[])=>Promise<string|null>}) {
  const existing=(purpose:GiroCashPlan['purpose'])=>data.giroCashPlans.find(p=>p.giroId===giro.id&&p.purpose===purpose);
  const [recover,setRecover]=useState(()=>existing('recover')?formatGiroMoneyInput(String(existing('recover')!.amountArs).replace('.',','),'ARS')||'':'');
  const [targetCurrency,setTargetCurrency]=useState<Currency>(existing('recover')?.targetCurrency||giro.currency);
  const [keep,setKeep]=useState(()=>existing('keep')?formatGiroMoneyInput(String(existing('keep')!.amountArs).replace('.',','),'ARS')||'':'');
  const [free,setFree]=useState(()=>existing('free')?formatGiroMoneyInput(String(existing('free')!.amountArs).replace('.',','),'ARS')||'':'');
  const [error,setError]=useState('');
  const fields=[{purpose:'recover' as const,value:recover,label:'Quiero usar para recuperar capital',change:setRecover},
    {purpose:'keep' as const,value:keep,label:'Mantendré en ARS',change:setKeep},
    {purpose:'free' as const,value:free,label:'Usaré libremente',change:setFree}];
  const assigned=fields.reduce((sum,field)=>sum+parseGiroMoneyInput(field.value),0);
  return <SheetFrame title="Destino del cobro" onClose={onClose}><form className="giro-form" onSubmit={async event=>{
    event.preventDefault();setError('');
    for(const field of fields){if(field.value){const issue=giroMoneyInputError(field.value,'ARS',true);if(issue){setError(`${field.label}: ${issue}`);return}}}
    const plans=fields.filter(field=>parseGiroMoneyInput(field.value)>0).map(field=>({giroId:giro.id,purpose:field.purpose,
      amountArs:parseGiroMoneyInput(field.value),targetCurrency:field.purpose==='recover'?targetCurrency:undefined}));
    const issue=validateGiroCashPlans(data,giro,plans);if(issue){setError(issue);return}
    const failed=await onSave(plans);if(failed)setError(failed);
  }}>
    <p className="form-hint">Indicá qué decidieron hacer con los ARS cobrados. Es solo una clasificación: no mueve dinero ni registra gastos. Podés dejar importes sin decidir.</p>
    {fields.map(field=><label key={field.purpose}>{field.label} · ARS<GiroMoneyField value={field.value} onChange={field.change} currency="ARS" placeholder="0"/></label>)}
    {parseGiroMoneyInput(recover)>0&&<label>Moneda que quiero recuperar<select value={targetCurrency} onChange={event=>setTargetCurrency(event.target.value as Currency)}>{CURRENCIES.map(currency=><option key={currency} value={currency}>{currency}</option>)}</select></label>}
    <div className="giro-preview"><span>Clasificado <b>{formatMoney(assigned,'ARS')}</b></span><span>Sin decidir <b>{formatMoney(Math.max(0,(giro.received||0)-assigned),'ARS')}</b></span></div>
    {error&&<p className="form-error" role="alert">{error}</p>}<button className="primary-button form-submit">Guardar destino</button>
  </form></SheetFrame>;
}

export function Giros({data,onNew,onEdit,onDelete,onLink,onUnlink,onPlan,onMove}:{data:FinanceData;onNew:()=>void;onEdit:(entry:Entry)=>void;onDelete:(entry:Entry)=>void;onLink:(entry:Entry)=>void;onUnlink:(link:GiroLink)=>void;onPlan:(entry:Entry)=>void;onMove:()=>void}) {
  const [month,setMonth]=useState(monthKey(today));
  const entries=sortedEntries(data.entries.filter(e=>e.kind==='giro'&&e.date.slice(0,7)===month));
  const balance=giroMonthlyBalance(data,month);
  const availableChanges=availableGiroChanges(data);
  const capital=(field:'used'|'recovered'|'unclassified')=>{
    const amounts=balance.capital.filter(x=>x[field]>0);
    return amounts.length?amounts.map(x=><strong key={x.currency}>{formatMoney(x[field],x.currency)}</strong>):<span>Sin registros</span>;
  };
  return <><div className="page-intro title-actions giro-title-actions"><div><h1>Giros de dinero</h1><p>Lo cobrado entra y lo entregado sale de sus cuentas generales.</p></div><button className="primary-button" onClick={onNew}><Plus size={18}/> Nuevo giro</button></div><div className="filter-row giro-filter"><div className="month-switch"><button aria-label="Mes anterior de giros" onClick={()=>setMonth(monthKey(shiftMonth(new Date(`${month}-01T12:00:00`),-1)))}><ChevronLeft size={16}/></button><span>{monthLabel(new Date(`${month}-01T12:00:00`))}</span><button aria-label="Mes siguiente de giros" disabled={month>=monthKey(today)} onClick={()=>setMonth(monthKey(shiftMonth(new Date(`${month}-01T12:00:00`),1)))}><ChevronRight size={16}/></button></div></div>
    <section className="panel giro-monthly"><h2>Balance de giros</h2><div className="giro-metrics"><div><span>Ganancia declarada · ARS</span><strong>{formatMoney(balance.profitArs,'ARS')}</strong><small>Separada de sueldos y saldos</small></div><div><span>Giros realizados</span><strong>{balance.count}</strong></div><div><span>Ganancias sin declarar</span><strong>{balance.pending}</strong></div></div>
      {balance.historicProfitArs!==0&&<p className="form-hint">Resultados históricos confirmados, por separado: {formatMoney(balance.historicProfitArs,'ARS')}.</p>}
      <div className="giro-capital"><span>Capital utilizado</span><div>{capital('used')}</div></div>
      <div className="giro-capital"><span>Recuperado en la moneda entregada</span><div>{capital('recovered')}</div></div>
      <div className="giro-capital"><span>Sin reposición vinculada</span><div>{capital('unclassified')}</div></div>
      {data.giroCashPlanReady&&<><div className="giro-capital"><span>ARS del cobro destinados a recuperar</span><div><strong>{formatMoney(balance.cash.find(x=>x.purpose==='recover')?.amountArs||0,'ARS')}</strong></div></div><div className="giro-capital"><span>ARS para mantener o usar libremente</span><div><strong>{formatMoney(balance.cash.filter(x=>x.purpose!=='recover').reduce((sum,x)=>sum+x.amountArs,0),'ARS')}</strong></div></div><div className="giro-capital"><span>ARS sin destino declarado</span><div><strong>{formatMoney(balance.unclassifiedArs,'ARS')}</strong></div></div></>}
      <p className="form-hint">Estas cifras son informativas: no son deudas. Los cambios entre monedas no se suman entre sí ni cuentan como ingresos.</p>
    </section>
    <section className="panel giro-history">
      <div className="section-head"><div><h2>Giros registrados</h2><p>Cada giro también aparece una sola vez en Movimientos.</p></div></div>
      {entries.length?entries.map(e=>{
        const result=data.giroResults.find(r=>r.giroId===e.id);
        const currency=receivedCurrency(data,e);
        const links=data.giroLinks.filter(l=>l.giroId===e.id);
        const plans=data.giroCashPlans.filter(p=>p.giroId===e.id);
        const gain=e.giroProfit!==undefined?formatMoney(e.giroProfit,e.giroProfitCurrency||currency):result?formatMoney(result.profitArs,'ARS'):'Sin declarar';
        const status=e.giroProfit!==undefined?'Declarada':result?'Resultado histórico':'Pendiente';
        const canLink=availableChanges.some(change=>!links.some(l=>l.transferId===change.id));
        return <div className="giro-row" key={e.id}>
          <div><strong>{e.giroReference||e.description}</strong><small>{e.date} · {status} · Origen: {data.accounts.find(a=>a.id===e.accountId)?.name||e.currency}</small></div>
          <div className="giro-row-values">
            <span>Recibido <b>{formatMoney(e.received||0,currency)}</b></span>
            <span>Entregado <b>{formatMoney(e.amount,e.currency)}</b></span>
            <span>Ganancia del giro <b>{gain}</b></span>
            <span>Recuperado en {e.currency} <b>{formatMoney(giroRecoveredCapital(data,e),e.currency)}</b></span>
            <span>Sin reposición vinculada <b>{formatMoney(giroCapitalPending(data,e),e.currency)}</b></span>
            {plans.map(plan=><span key={plan.purpose}>{plan.purpose==='recover'?`ARS para recuperar ${plan.targetCurrency}`:plan.purpose==='keep'?'ARS para mantener':'ARS de uso libre'} <b>{formatMoney(plan.amountArs,'ARS')}</b></span>)}
            {links.map(link=>{const transfer=data.entries.find(x=>x.id===link.transferId);return <span key={link.id}>Cambio vinculado <b>{transfer?`${formatMoney(link.fromAmount,transfer.currency)} → ${formatMoney(link.toAmount,receivedCurrency(data,transfer))}`:link.transferId}</b>{!result&&<button className="text-link" onClick={()=>onUnlink(link)}>Quitar vínculo</button>}</span>})}
          </div>
          <div className="giro-actions">
            {data.giroAccountingReady&&canLink&&<button className="text-link" onClick={()=>onLink(e)}>Vincular cambio existente</button>}
            {data.giroCashPlanReady&&currency==='ARS'&&<button className="text-link" onClick={()=>onPlan(e)}>Destino del cobro</button>}
            {result&&<details><summary>Ver resultado histórico</summary><small>Cobrado {formatMoney(e.received||0,'ARS')} − costo {formatMoney(result.costArs,'ARS')} − comisiones {formatMoney(result.feesArs,'ARS')} = {formatMoney(result.profitArs,'ARS')}. {result.evidence}.</small></details>}
            {!result&&<><button className="text-link" onClick={()=>onEdit(e)}>Editar <ArrowRight size={13}/></button><button className="row-delete" onClick={()=>onDelete(e)}>Eliminar</button></>}
          </div>
        </div>;
      }):<Empty text="Todavía no hay giros en este mes."/>}
      <button className="text-link" onClick={onMove}>Mover dinero entre cuentas <ArrowRight size={13}/></button>
      {!data.giroAccountingReady&&<p className="form-hint">Los vínculos opcionales estarán disponibles al aplicar la migración de Giros.</p>}
    </section></>;
}
