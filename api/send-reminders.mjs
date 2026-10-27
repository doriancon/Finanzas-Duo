import {createHmac,timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import webpush from 'web-push';
import {deliverDueFundReminders} from '../server/fund-reminders.mjs';

export function authorizedReminderCron(request,secret,now=Date.now()){
  const timestamp=request.headers.get('x-duo-cron-time');
  const signature=request.headers.get('x-duo-cron-signature');
  if(!secret||!timestamp||!/^[0-9]{10,13}$/.test(timestamp)||!signature||
      !/^[0-9a-f]{64}$/i.test(signature))return false;
  const seconds=Number(timestamp);
  if(!Number.isSafeInteger(seconds)||Math.abs(Math.floor(now/1000)-seconds)>300)return false;
  const expected=createHmac('sha256',secret).update(`${timestamp}\n/api/send-reminders`).digest('hex');
  const supplied=Buffer.from(signature,'hex'),correct=Buffer.from(expected,'hex');
  return timingSafeEqual(supplied,correct);
}

export default {
  async fetch(request){
    if(request.method!=='POST')return new Response('Method not allowed',{status:405});
    if(!authorizedReminderCron(request,process.env.DUO_REMINDER_CRON_SECRET))
      return new Response('Unauthorized',{status:401});
    const projectUrl=process.env.DUO_REMINDER_SUPABASE_URL?.trim();
    const serviceKey=process.env.DUO_PUSH_SUPABASE_SERVICE_ROLE_KEY;
    const publicKey=process.env.VITE_PUSH_VAPID_PUBLIC_KEY;
    const privateKey=process.env.DUO_PUSH_VAPID_PRIVATE_KEY;
    const subject=process.env.DUO_PUSH_VAPID_SUBJECT;
    if(!projectUrl||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(projectUrl)||
        !serviceKey||!publicKey||!privateKey||!subject)
      return new Response('Push server is not configured',{status:503});
    try{
      webpush.setVapidDetails(subject,publicKey,privateKey);
      const client=createClient(projectUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
      return Response.json(await deliverDueFundReminders(client,webpush.sendNotification));
    }catch{
      console.error('No se pudieron procesar los recordatorios.');
      return new Response('Reminder delivery failed',{status:500});
    }
  },
};
