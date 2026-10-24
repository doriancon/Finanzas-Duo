import { roundMoney } from './domain.ts';
import type { Currency, Entry, FinanceData, GiroLink } from './domain.ts';

const near = (a:number,b:number,currency:Currency) => Math.abs(a-b) <= (currency==='USDT'?0.000001:0.01)+1e-8;
const toCurrency = (data:FinanceData,entry:Entry) => data.accounts.find(a=>a.id===entry.toAccountId)?.currency;

export function validateGiroLink(data:FinanceData,link:GiroLink):string|null {
  const giro=data.entries.find(e=>e.id===link.giroId&&e.kind==='giro');
  const transfer=data.entries.find(e=>e.id===link.transferId&&e.kind==='transfer');
  if(!giro||!transfer)return 'Elegí un giro y un cambio de moneda existentes.';
  if(data.giroLinks.some(x=>x.id!==link.id&&x.giroId===link.giroId&&x.transferId===link.transferId))
    return 'Este cambio ya está vinculado al giro.';
  const target=toCurrency(data,transfer);
  if(!target||!transfer.received||target===transfer.currency)return 'Vinculá un cambio entre monedas distintas.';
  if(!Number.isFinite(link.fromAmount)||!Number.isFinite(link.toAmount)||link.fromAmount<=0||link.toAmount<=0||
      !near(roundMoney(link.fromAmount,transfer.currency),link.fromAmount,transfer.currency)||
      !near(roundMoney(link.toAmount,target),link.toAmount,target))return 'Los importes asignados no son válidos.';
  const others=data.giroLinks.filter(x=>x.transferId===transfer.id&&x.id!==link.id);
  if(others.reduce((n,x)=>n+x.fromAmount,link.fromAmount)>transfer.amount+1e-8||
      others.reduce((n,x)=>n+x.toAmount,link.toAmount)>transfer.received+1e-8)return 'Este cambio ya está asignado a otros giros.';
  if(target===giro.currency&&data.giroLinks.filter(x=>x.giroId===giro.id&&x.id!==link.id).reduce((sum,x)=>{
      const move=data.entries.find(e=>e.id===x.transferId);
      return sum+(move&&toCurrency(data,move)===giro.currency?x.toAmount:0);
    },link.toAmount)>giro.amount+1e-8)return 'La reposición supera el capital entregado en este giro.';
  const result=data.giroResults.find(r=>r.giroId===giro.id);
  if(result&&transfer.currency==='ARS'&&data.giroLinks.filter(x=>x.giroId===giro.id&&x.id!==link.id)
      .reduce((sum,x)=>sum+(data.entries.find(e=>e.id===x.transferId)?.currency==='ARS'?x.fromAmount:0),link.fromAmount)>result.costArs+1e-8)
    return 'La reposición supera el costo ARS ya confirmado.';
  if(!near(link.toAmount,roundMoney(transfer.received*link.fromAmount/transfer.amount,target),target))
    return 'La parte recibida debe corresponder proporcionalmente a la parte entregada.';
  return null;
}

export function giroCapitalPending(data:FinanceData,giro:Entry):number {
  const recovered=data.giroLinks.filter(link=>link.giroId===giro.id).reduce((sum,link)=>{
    const transfer=data.entries.find(e=>e.id===link.transferId&&e.kind==='transfer');
    return sum+(transfer&&toCurrency(data,transfer)===giro.currency?link.toAmount:0);
  },0);
  return roundMoney(Math.max(0,giro.amount-recovered),giro.currency);
}

export function giroDocumentedCost(data:FinanceData,giro:Entry):number|null {
  if(toCurrency(data,giro)!=='ARS'||giroCapitalPending(data,giro)>0)return null;
  const flows=new Map<Currency,{in:number;out:number}>();
  for(const link of data.giroLinks.filter(x=>x.giroId===giro.id)){
    const transfer=data.entries.find(e=>e.id===link.transferId&&e.kind==='transfer');
    if(!transfer||validateGiroLink(data,link))return null;
    const target=toCurrency(data,transfer);
    if(!target)return null;
    const sourceFlow=flows.get(transfer.currency)||{in:0,out:0};sourceFlow.out+=link.fromAmount;flows.set(transfer.currency,sourceFlow);
    const targetFlow=flows.get(target)||{in:0,out:0};targetFlow.in+=link.toAmount;flows.set(target,targetFlow);
  }
  for(const [currency,flow] of flows)if(currency!=='ARS'&&currency!==giro.currency&&flow.out>flow.in+(currency==='USDT'?0.000001:0.01))return null;
  const cost=flows.get('ARS')?.out||0;
  return cost>0?roundMoney(cost,'ARS'):null;
}

export function giroMonthlyBalance(data:FinanceData,month:string){
  const giros=data.entries.filter(e=>e.kind==='giro'&&e.date.slice(0,7)===month);
  const confirmed=data.giroResults.filter(result=>result.recognizedMonth===month);
  const capital=(['ARS','BOB','USD','USDT'] as Currency[]).map(currency=>({currency,amount:roundMoney(giros.filter(g=>g.currency===currency).reduce((sum,g)=>sum+giroCapitalPending(data,g),0),currency)}));
  return {count:giros.length,pending:giros.filter(g=>!data.giroResults.some(r=>r.giroId===g.id)).length,
    profitArs:roundMoney(confirmed.reduce((sum,r)=>sum+r.profitArs,0),'ARS'),capital};
}
