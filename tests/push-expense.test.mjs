import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/push-expense.mjs';
import {allowedPushEndpoint,deliverExpenseEvent,expensePushPayload} from '../server/push-expense.mjs';

const event={id:'11111111-1111-4111-8111-111111111111',space_id:'space-a',entry_id:'expense-1',
  actor_user_id:'user-dani',actor_name:'Dani',amount:25_000,currency:'ARS',category_name:'Supermercado',created_at:'2026-10-24T12:00:00Z'};
const endpoint='https://fcm.googleapis.com/fcm/send/test-subscription';

function fakeClient(subscriptions,eventRow=event){
  const claims=new Set();
  const rows=[...subscriptions];
  const calls=[];
  const from=table=>({
    select(){return {
      eq(column,value){
        if(table==='finance_push_events')return {maybeSingle:async()=>({data:value===eventRow.id?eventRow:null,error:null})};
        if(table==='finance_push_subscriptions')return {
          lte:async(_,date)=>({data:rows.filter(row=>row.space_id===value&&row.created_at<=date),error:null}),
        };
        throw new Error(`Unexpected select: ${table}.${column}`);
      },
    }},
    insert(row){
      assert.equal(table,'finance_push_deliveries');
      const key=`${row.event_id}:${row.subscription_id}`;
      if(claims.has(key))return Promise.resolve({error:{code:'23505'}});
      claims.add(key);calls.push({table,action:'insert',row});return Promise.resolve({data:null,error:null});
    },
    update(row){return {eq:()=>({eq:async()=>{calls.push({table,action:'update',row});return {data:null,error:null}}})}},
    delete(){return {eq:async(_,id)=>{calls.push({table,action:'delete',id});return {data:null,error:null}}}},
  });
  return {client:{from},claims,calls};
}

test('a confirmed personal expense is formatted with actor, amount, currency and category',()=>{
  const payload=JSON.parse(expensePushPayload(event));
  assert.equal(payload.type,'duo-personal-expense');
  assert.equal(payload.body,'Dani registró un gasto de $25.000 ARS · Supermercado');
  assert.equal(payload.id,event.id);
});

test('a person in another independent space keeps their own visible name in notifications',()=>{
  const payload=JSON.parse(expensePushPayload({...event,actor_name:'Camila'}));
  assert.equal(payload.body,'Camila registró un gasto de $25.000 ARS · Supermercado');
});

test('push endpoints must use known HTTPS browser push providers',()=>{
  assert.equal(allowedPushEndpoint(endpoint),true);
  assert.equal(allowedPushEndpoint('https://web.push.apple.com/Q123'),true);
  assert.equal(allowedPushEndpoint('https://wns2-pn1p.notify.windows.com/?token=x'),true);
  assert.equal(allowedPushEndpoint('http://fcm.googleapis.com/x'),false);
  assert.equal(allowedPushEndpoint('https://fcm.googleapis.com.evil.test/x'),false);
  assert.equal(allowedPushEndpoint('https://127.0.0.1/x'),false);
});

test('webhook retries never resend to a device and subscribers from other spaces are excluded',async()=>{
  const fixture=fakeClient([
    {id:'device-a',space_id:'space-a',user_id:'user-dorian',endpoint,p256dh:'p',auth_key:'a',created_at:'2026-10-23T12:00:00Z'},
    {id:'device-other',space_id:'space-b',user_id:'user-other',endpoint:'https://web.push.apple.com/x',p256dh:'p',auth_key:'a',created_at:'2026-10-23T12:00:00Z'},
    {id:'device-later',space_id:'space-a',user_id:'user-dorian',endpoint:'https://web.push.apple.com/y',p256dh:'p',auth_key:'a',created_at:'2026-10-25T12:00:00Z'},
  ]);
  const sent=[];
  const send=async(subscription,payload)=>{sent.push({subscription,payload})};
  assert.deepEqual(await deliverExpenseEvent(fixture.client,event.id,send),{sent:1,skipped:0,failed:0});
  assert.deepEqual(await deliverExpenseEvent(fixture.client,event.id,send),{sent:0,skipped:1,failed:0});
  assert.equal(sent.length,1);
  assert.equal(sent[0].subscription.endpoint,endpoint);
  assert.equal(fixture.claims.size,1);
});

test('only other members receive a personal expense, including on several devices',async()=>{
  for(const actorId of ['user-dani','user-dorian']){
    const otherId=actorId==='user-dani'?'user-dorian':'user-dani';
    const fixture=fakeClient([
      {id:'author-iphone',space_id:'space-a',user_id:actorId,endpoint:'https://web.push.apple.com/author',created_at:'2026-10-23T12:00:00Z'},
      {id:'author-chrome',space_id:'space-a',user_id:actorId,endpoint:'https://fcm.googleapis.com/author',created_at:'2026-10-23T12:00:00Z'},
      {id:'other-iphone',space_id:'space-a',user_id:otherId,endpoint:'https://web.push.apple.com/other',p256dh:'p',auth_key:'a',created_at:'2026-10-23T12:00:00Z'},
      {id:'other-chrome',space_id:'space-a',user_id:otherId,endpoint:'https://fcm.googleapis.com/other',p256dh:'p',auth_key:'a',created_at:'2026-10-23T12:00:00Z'},
      {id:'third-member',space_id:'space-a',user_id:'user-third',endpoint:'https://web.push.apple.com/third',p256dh:'p',auth_key:'a',created_at:'2026-10-23T12:00:00Z'},
      {id:'another-space',space_id:'space-b',user_id:'user-fourth',endpoint:'https://web.push.apple.com/fourth',created_at:'2026-10-23T12:00:00Z'},
    ],{...event,actor_user_id:actorId,actor_name:'Dani'});
    const sent=[];
    const send=async subscription=>{sent.push(subscription.endpoint)};
    assert.deepEqual(await deliverExpenseEvent(fixture.client,event.id,send),{sent:3,skipped:0,failed:0});
    assert.deepEqual(await deliverExpenseEvent(fixture.client,event.id,send),{sent:0,skipped:3,failed:0});
    assert.equal(sent.length,3);
    assert.deepEqual(fixture.calls.filter(call=>call.action==='insert').map(call=>call.row.subscription_id),
      ['other-iphone','other-chrome','third-member']);
  }
});

test('an event without an author id does not send or claim notifications',async()=>{
  const fixture=fakeClient([{id:'device',space_id:'space-a',user_id:'user-dorian',endpoint,
    p256dh:'p',auth_key:'a',created_at:'2026-10-23T12:00:00Z'}],{...event,actor_user_id:null});
  let sent=0;
  assert.deepEqual(await deliverExpenseEvent(fixture.client,event.id,async()=>{sent++}),{sent:0,skipped:0,failed:0});
  assert.equal(sent,0);
  assert.equal(fixture.claims.size,0);
});

test('invalid or expired endpoints are not retried and expired subscriptions are removed',async()=>{
  const fixture=fakeClient([
    {id:'invalid',space_id:'space-a',user_id:'user-dorian',endpoint:'https://internal.test/x',p256dh:'p',auth_key:'a',created_at:'2026-10-23T12:00:00Z'},
    {id:'expired',space_id:'space-a',user_id:'user-dorian',endpoint,p256dh:'p',auth_key:'a',created_at:'2026-10-23T12:00:00Z'},
  ]);
  let attempts=0;
  const send=async()=>{attempts++;throw {statusCode:410}};
  assert.deepEqual(await deliverExpenseEvent(fixture.client,event.id,send),{sent:0,skipped:0,failed:2});
  assert.deepEqual(await deliverExpenseEvent(fixture.client,event.id,send),{sent:0,skipped:2,failed:0});
  assert.equal(attempts,1);
  assert.equal(fixture.calls.some(call=>call.table==='finance_push_subscriptions'&&call.action==='delete'),true);
});

test('public requests cannot invoke the Vercel sender',async()=>{
  const response=await handler.fetch(new Request('https://finanzas-duo-liard.vercel.app/api/push-expense',{
    method:'POST',body:'{}',headers:{'content-type':'application/json'},
  }));
  assert.equal(response.status,401);
});
