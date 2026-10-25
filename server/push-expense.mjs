const money=(amount,currency)=>{
  const value=new Intl.NumberFormat('es-AR',{maximumFractionDigits:currency==='USDT'?6:2}).format(Number(amount));
  return currency==='ARS'?`$${value} ARS`:currency==='BOB'?`Bs ${value} BOB`:currency==='USD'?`US$${value} USD`:`${value} USDT`;
};

export function expensePushPayload(event){
  const actor=typeof event.actor_name==='string'&&event.actor_name.trim()
    ? event.actor_name.trim().replace(/\s+/g,' ').slice(0,80) : 'Un miembro';
  return JSON.stringify({type:'duo-personal-expense',id:event.id,
    body:`${actor} registró un gasto de ${money(event.amount,event.currency)} · ${event.category_name||'Sin categoría'}`});
}

export function allowedPushEndpoint(endpoint){
  try{
    const url=new URL(endpoint);
    if(url.protocol!=='https:'||url.username||url.password||url.port)return false;
    const host=url.hostname.toLowerCase();
    return host==='fcm.googleapis.com'||host==='android.googleapis.com'||
      host==='updates.push.services.mozilla.com'||host==='push.services.mozilla.com'||
      host==='web.push.apple.com'||host.endsWith('.push.apple.com')||
      host.endsWith('.notify.windows.com');
  }catch{return false}
}

const checked=(result)=>{if(result.error)throw new Error(result.error.message);return result.data};

export async function deliverExpenseEvent(client,eventId,sendNotification){
  const event=checked(await client.from('finance_push_events').select('*').eq('id',eventId).maybeSingle());
  // Si falta la autoría, no podemos garantizar que el autor quede excluido.
  if(!event?.actor_user_id)return {sent:0,skipped:0,failed:0};
  const subscriptions=checked(await client.from('finance_push_subscriptions')
    .select('id,user_id,endpoint,p256dh,auth_key,created_at').eq('space_id',event.space_id)
    .lte('created_at',event.created_at));
  const payload=expensePushPayload(event);
  const result={sent:0,skipped:0,failed:0};
  for(const subscription of subscriptions){
    if(!subscription.user_id||subscription.user_id===event.actor_user_id)continue;
    const claim=await client.from('finance_push_deliveries').insert({
      event_id:event.id,subscription_id:subscription.id,
    });
    if(claim.error?.code==='23505'){result.skipped++;continue}
    checked(claim);
    if(!allowedPushEndpoint(subscription.endpoint)){
      checked(await client.from('finance_push_deliveries').update({error_status:'invalid_endpoint'})
        .eq('event_id',event.id).eq('subscription_id',subscription.id));
      result.failed++;
      continue;
    }
    try{
      await sendNotification({endpoint:subscription.endpoint,keys:{
        p256dh:subscription.p256dh,auth:subscription.auth_key,
      }},payload,{TTL:3600,urgency:'normal',topic:event.id.replaceAll('-','').slice(0,32)});
    }catch(error){
      const status=Number(error?.statusCode)||0;
      checked(await client.from('finance_push_deliveries').update({error_status:String(status||'send_failed')})
        .eq('event_id',event.id).eq('subscription_id',subscription.id));
      if(status===404||status===410)checked(await client.from('finance_push_subscriptions').delete().eq('id',subscription.id));
      result.failed++;
      continue;
    }
    checked(await client.from('finance_push_deliveries').update({sent_at:new Date().toISOString()})
      .eq('event_id',event.id).eq('subscription_id',subscription.id));
    result.sent++;
  }
  return result;
}
