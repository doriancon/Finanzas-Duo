import {Edit3,Plus} from 'lucide-react';
import {Category,FinanceData} from './domain';
import {iconFor} from './ui';

const businessDefaults=new Set(['telas','materiales','confeccion','insumos','empaques','elasticos','transporte','otros','operativos']);

export function BusinessCategories({data,onAdd,onEdit}:{data:FinanceData;onAdd:()=>void;onEdit:(category:Category)=>void}) {
  const used=new Set(data.entries.filter(e=>e.kind==='expense'&&e.scope==='business').map(e=>e.categoryId));
  const categories=data.categories.filter(c=>!c.archived&&(businessDefaults.has(c.id)||used.has(c.id)));
  return <section className="panel business-categories"><div className="section-head"><div><h2>Categorías de Lencería</h2><p>Personalizá nombres, colores e iconos para registrar insumos y servicios.</p></div><button className="small-add" onClick={onAdd}><Plus size={16}/> Nueva</button></div><div className="business-category-grid">{categories.map(c=><button key={c.id} onClick={()=>onEdit(c)}><i style={{background:c.color}}/>{iconFor(c.icon,16)}<span>{c.name}</span><Edit3 size={15}/></button>)}</div></section>;
}
