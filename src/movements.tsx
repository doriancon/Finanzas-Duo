import {useState} from 'react';
import {ArrowRight,Plus,Search,Trash2} from 'lucide-react';
import {CURRENCIES,Currency,dateISO,Entry,FinanceData,monthKey,monthLabel,paginate,Scope,shiftMonth} from './domain';
import {categoryName,Empty,EntryRow,incomeSourceName} from './ui';
import {sortedEntries} from './entry-order';

export function Movements({data,onNew,onEdit,onDelete}:{data:FinanceData;onNew:()=>void;onEdit:(entry:Entry)=>void;onDelete:(entry:Entry)=>void}) {
  const [month,setMonth]=useState(monthKey(new Date()));
  const [scope,setScope]=useState<'all'|Scope>('all');
  const [currency,setCurrency]=useState<'all'|Currency>('all');
  const [category,setCategory]=useState('all');
  const [kind,setKind]=useState('all');
  const [query,setQuery]=useState('');
  const [pageSize,setPageSize]=useState<10|20|50>(20);
  const [page,setPage]=useState(1);
  const reset=()=>setPage(1);
  const filtered=sortedEntries(data.entries.filter(e=>e.date.slice(0,7)===month &&
    (scope==='all'||e.scope===scope) &&
    (currency==='all'||e.currency===currency||((e.kind==='giro'||e.kind==='transfer')&&data.accounts.find(a=>a.id===e.toAccountId)?.currency===currency)) &&
    (category==='all'||e.categoryId===category) &&
    (kind==='all'||e.kind===kind) &&
    `${e.description} ${e.giroReference||''} ${categoryName(data,e.categoryId)} ${incomeSourceName(data,e.incomeSourceId)}`.toLocaleLowerCase('es-AR').includes(query.toLocaleLowerCase('es-AR'))));
  const {pages,currentPage,visible}=paginate(filtered,page,pageSize);
  const changeMonth=(offset:number)=>{setMonth(monthKey(shiftMonth(new Date(`${month}-01T12:00:00`),offset)));reset()};
  const exportCSV=()=>{
    const quote=(value:unknown)=>{const raw=String(value??'');const safe=typeof value==='string'&&/^[=+@-]/.test(raw)?`'${raw}`:raw;return `"${safe.replaceAll('"','""')}"`};
    const rows=[['Fecha','Tipo','Ámbito','Descripción','Moneda entregada','Monto entregado','Cuenta origen','Moneda recibida','Monto recibido','Cuenta destino','Categoría','Ganancia giro'],...data.entries.map(e=>[e.date,e.kind,e.scope,e.description,e.currency,e.amount,e.accountId||'',data.accounts.find(a=>a.id===e.toAccountId)?.currency||'',e.received??'',e.toAccountId||'',categoryName(data,e.categoryId),e.giroProfit??''])];
    const blob=new Blob(['\uFEFF',rows.map(row=>row.map(quote).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`duo-finance-historial-${dateISO(new Date())}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <>
    <div className="page-intro title-actions"><div><h1>Cada movimiento, claro.</h1><p>Todas las entradas y salidas del mismo sistema de cuentas.</p></div><button className="primary-button" onClick={onNew}><Plus size={18}/> Agregar movimiento</button></div>
    <div className="history-toolbar"><div className="month-switch"><button aria-label="Mes anterior" onClick={()=>changeMonth(-1)}><ArrowRight className="flip-horizontal" size={15}/></button><span>{monthLabel(new Date(`${month}-01T12:00:00`))}</span><button aria-label="Mes siguiente" onClick={()=>changeMonth(1)}><ArrowRight size={15}/></button></div><label className="history-month-label">Mes <input type="month" value={month} onChange={e=>{setMonth(e.target.value);reset()}}/></label><button className="small-add" onClick={exportCSV}>Exportar CSV</button></div>
    <div className="movement-filters"><div className="search"><Search size={18}/><input aria-label="Buscar movimientos" placeholder="Buscar descripción" value={query} onChange={e=>{setQuery(e.target.value);reset()}}/></div><select aria-label="Ámbito" value={scope} onChange={e=>{setScope(e.target.value as typeof scope);reset()}}><option value="all">Todos los movimientos</option><option value="everyday">Vida cotidiana</option><option value="business">Lencería</option><option value="giro">Giros</option><option value="receivable">Préstamos y cobros de deudas</option></select><select aria-label="Moneda" value={currency} onChange={e=>{setCurrency(e.target.value as typeof currency);reset()}}><option value="all">Todas las monedas</option>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select><select aria-label="Categoría" value={category} onChange={e=>{setCategory(e.target.value);reset()}}><option value="all">Todas las categorías</option>{data.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><select aria-label="Tipo de operación" value={kind} onChange={e=>{setKind(e.target.value);reset()}}><option value="all">Todos los tipos</option><option value="expense">Gastos</option><option value="income">Ingresos</option><option value="transfer">Mover dinero</option><option value="giro">Giros</option><option value="reserve">Aportes a ahorros</option><option value="withdraw">Retiros de ahorros</option></select></div>
    <section className="panel movement-list"><div className="section-head"><h2>Historial de {monthLabel(new Date(`${month}-01T12:00:00`))}</h2><span>{filtered.length} movimientos</span></div>{visible.length?visible.map(e=><div className="history-item" key={e.id}><EntryRow data={data} entry={e} actions={e.scope==='receivable'?null:<div className="history-actions"><button className="text-link" onClick={()=>onEdit(e)}>Editar</button><button className="row-delete" aria-label={`Eliminar ${e.description}`} onClick={()=>onDelete(e)}><Trash2 size={15}/></button></div>}/></div>):<Empty text="No hay movimientos con estos filtros en este mes."/>}<div className="history-pages"><label>Por página <select aria-label="Movimientos por página" value={pageSize} onChange={e=>{setPageSize(Number(e.target.value) as 10|20|50);reset()}}><option>10</option><option>20</option><option>50</option></select></label><button disabled={currentPage<=1} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {currentPage} de {pages}</span><button disabled={currentPage>=pages} onClick={()=>setPage(p=>p+1)}>Siguiente</button></div></section>
  </>;
}
