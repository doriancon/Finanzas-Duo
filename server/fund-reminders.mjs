import {allowedPushEndpoint} from './push-expense.mjs';

const checked=result=>{if(result.error)throw new Error(result.error.message);return result.data};
const money=(amount,currency)=>new Intl.NumberFormat('es-AR',{
  maximumFractionDigits:currency==='USDT'?6:2,
}).format(Number(amount));
const symbol={ARS:'$',BOB:'Bs ',USD:'US$',USDT:''};

export function fundReminderPayload(event){
  const fund=String(event.fund_name||'tu fondo').replace(/\s+/g,' ').slice(0,100);
  return JSON.stringify({type:'duo-fund-reminder',id:event.id,
    body:`Recordatorio de ahorro: hoy te toca aportar ${symbol[event.currency]||''}${money(event.amount,event.currency)}${event.currency==='USDT'?' USDT':''} a ${fund}.`});
}

export async function deliverDueFundReminders(client,sendNotification,now=new Date()){
  checked(await client.rpc('enqueue_due_finance_fund_reminders'));
  const events=checked(await client.from('finance_fund_reminder_events').select('*')
    .gte('scheduled_for',new Date(now.getTime()-24*60*60*1000).toISOString())
    .lte('scheduled_for',now.toISOString()).order('scheduled_for',{ascending:true}).limit(200));
  const result={sent:0,skipped:0,failed:0};
  for(const event of events){
    const reminder=checked(await client.from('finance_fund_reminders')
      .select('enabled,revision').eq('space_id',event.space_id).eq('id',event.reminder_id).maybeSingle());
    if(!reminder?.enabled||reminder.revision!==event.revision)continue;
    const subscriptions=checked(await client.from('finance_push_subscriptions')
      .select('id,endpoint,p256dh,auth_key,created_at')
      .eq('space_id',event.space_id).eq('user_id',event.user_id)
      .lte('created_at',event.scheduled_for));
    const payload=fundReminderPayload(event);
    for(const subscription of subscriptions){
      const claim=await client.from('finance_fund_reminder_deliveries').insert({
        space_id:event.space_id,event_id:event.id,subscription_id:subscription.id,
      });
      if(claim.error?.code==='23505'){result.skipped++;continue}
      checked(claim);
      if(!allowedPushEndpoint(subscription.endpoint)){
        checked(await client.from('finance_fund_reminder_deliveries').update({error_status:'invalid_endpoint'})
          .eq('space_id',event.space_id).eq('event_id',event.id).eq('subscription_id',subscription.id));
        result.failed++;continue;
      }
      try{
        await sendNotification({endpoint:subscription.endpoint,keys:{
          p256dh:subscription.p256dh,auth:subscription.auth_key,
        }},payload,{TTL:3600,urgency:'normal',topic:event.id.replaceAll('-','').slice(0,32)});
      }catch(error){
        const status=Number(error?.statusCode)||0;
        checked(await client.from('finance_fund_reminder_deliveries').update({error_status:String(status||'send_failed')})
          .eq('space_id',event.space_id).eq('event_id',event.id).eq('subscription_id',subscription.id));
        if(status===404||status===410)checked(await client.from('finance_push_subscriptions').delete().eq('id',subscription.id));
        result.failed++;continue;
      }
      checked(await client.from('finance_fund_reminder_deliveries').update({sent_at:new Date().toISOString()})
        .eq('space_id',event.space_id).eq('event_id',event.id).eq('subscription_id',subscription.id));
      result.sent++;
    }
  }
  return result;
}
