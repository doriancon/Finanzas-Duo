import {timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import webpush from 'web-push';
import {deliverExpenseEvent} from '../server/push-expense.mjs';

const TEST_PROJECT_URL='https://ueobsnszhtdcywppheoq.supabase.co';
const sameSecret=(given,expected)=>{
  if(!given||!expected)return false;
  const a=Buffer.from(given),b=Buffer.from(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
};

export default {
  async fetch(request){
    if(request.method!=='POST')return new Response('Method not allowed',{status:405});
    const secret=process.env.DUO_PUSH_WEBHOOK_SECRET;
    if(!sameSecret(request.headers.get('x-duo-push-secret'),secret))
      return new Response('Unauthorized',{status:401});
    const serviceKey=process.env.DUO_PUSH_SUPABASE_SERVICE_ROLE_KEY;
    const publicKey=process.env.VITE_PUSH_VAPID_PUBLIC_KEY;
    const privateKey=process.env.DUO_PUSH_VAPID_PRIVATE_KEY;
    const subject=process.env.DUO_PUSH_VAPID_SUBJECT;
    if(!serviceKey||!publicKey||!privateKey||!subject)
      return new Response('Push server is not configured',{status:503});
    let payload;
    try{payload=await request.json()}catch{return new Response('Invalid JSON',{status:400})}
    const id=payload?.record?.id;
    if(payload?.type!=='INSERT'||payload?.schema!=='public'||payload?.table!=='finance_push_events'||
        typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))
      return new Response('Invalid event',{status:400});
    try{
      webpush.setVapidDetails(subject,publicKey,privateKey);
      const client=createClient(TEST_PROJECT_URL,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
      const result=await deliverExpenseEvent(client,id,webpush.sendNotification);
      return Response.json(result);
    }catch(error){
      console.error('No se pudo procesar un evento Web Push:',error instanceof Error?error.message:'error desconocido');
      return new Response('Push delivery failed',{status:500});
    }
  },
};
