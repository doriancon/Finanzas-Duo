import { roundMoney } from './domain.ts';
import type { Currency, Entry, FinanceData, GiroCashPlan, GiroLink } from './domain.ts';

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

export function giroRecoveredCapital(data:FinanceData,giro:Entry):number {
  return roundMoney(Math.max(0,giro.amount-giroCapitalPending(data,giro)),giro.currency);
}

export function availableGiroChanges(data:FinanceData):Entry[] {
  return data.entries.filter(e=>e.kind==='transfer'&&e.received!==undefined&&
    toCurrency(data,e)!==undefined&&toCurrency(data,e)!==e.currency&&
    roundMoney(e.amount-data.giroLinks.filter(l=>l.transferId===e.id)
      .reduce((sum,l)=>sum+l.fromAmount,0),e.currency)>0);
}

export function validateGiroCashPlans(data:FinanceData,giro:Entry,plans:GiroCashPlan[]):string|null {
  if(giro.kind!=='giro'||toCurrency(data,giro)!=='ARS')return 'El destino del cobro solo se registra para giros recibidos en ARS.';
  if(new Set(plans.map(p=>p.purpose)).size!==plans.length||plans.some(p=>p.giroId!==giro.id||
      !['recover','keep','free'].includes(p.purpose)||!Number.isFinite(p.amountArs)||p.amountArs<=0||
      roundMoney(p.amountArs,'ARS')!==p.amountArs||
      (p.purpose==='recover'?!(['ARS','BOB','USD','USDT'] as string[]).includes(p.targetCurrency||''):p.targetCurrency!==undefined)))
    return 'Revisá los importes y la moneda del destino del cobro.';
  if(roundMoney(plans.reduce((sum,p)=>sum+p.amountArs,0),'ARS')>(giro.received||0))
    return 'La suma de destinos supera el total cobrado en este giro.';
  return null;
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
  const declared=giros.filter(g=>g.giroProfit!==undefined&&(g.giroProfitCurrency||toCurrency(data,g))==='ARS');
  const historical=data.giroResults.filter(result=>result.recognizedMonth===month&&
    !data.entries.some(g=>g.id===result.giroId&&g.giroProfit!==undefined));
  const currencies=(['ARS','BOB','USD','USDT'] as Currency[]);
  const capital=currencies.map(currency=>{
    const selected=giros.filter(g=>g.currency===currency);
    return {currency,
      used:roundMoney(selected.reduce((sum,g)=>sum+g.amount,0),currency),
      recovered:roundMoney(selected.reduce((sum,g)=>sum+giroRecoveredCapital(data,g),0),currency),
      unclassified:roundMoney(selected.reduce((sum,g)=>sum+giroCapitalPending(data,g),0),currency)};
  });
  const cashPlans=data.giroCashPlans.filter(p=>giros.some(g=>g.id===p.giroId));
  const cash=(['recover','keep','free'] as const).map(purpose=>({purpose,
    amountArs:roundMoney(cashPlans.filter(p=>p.purpose===purpose).reduce((sum,p)=>sum+p.amountArs,0),'ARS')}));
  const unclassifiedArs=roundMoney(Math.max(0,giros.filter(g=>toCurrency(data,g)==='ARS').reduce((sum,g)=>sum+(g.received||0),0)-
    cashPlans.reduce((sum,p)=>sum+p.amountArs,0)),'ARS');
  return {count:giros.length,
    pending:giros.filter(g=>g.giroProfit===undefined&&!data.giroResults.some(r=>r.giroId===g.id)).length,
    profitArs:roundMoney(declared.reduce((sum,g)=>sum+(g.giroProfit||0),0),'ARS'),
    historicProfitArs:roundMoney(historical.reduce((sum,r)=>sum+r.profitArs,0),'ARS'),
    capital,cash,unclassifiedArs};
}
