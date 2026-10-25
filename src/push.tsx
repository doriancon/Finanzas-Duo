import {useEffect,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {SharedSpace} from './auth';
import {supabase} from './supabase';

const vapidPublicKey=import.meta.env.VITE_PUSH_VAPID_PUBLIC_KEY?.trim()||'';
type PushName='Dorian'|'Dani';

const supported=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const keyBytes=(key:string)=>{
  const encoded=key.replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'='));
  const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return bytes;
};
const currentUser=async(client:SupabaseClient)=>{
  const {data,error}=await client.auth.getUser();
  if(error||!data.user)throw new Error('Iniciá sesión para configurar las notificaciones.');
  return data.user.id;
};

async function readSettings(client:SupabaseClient,spaceId:string){
  const userId=await currentUser(client);
  const profile=await client.from('finance_push_profiles').select('display_name')
    .eq('space_id',spaceId).eq('user_id',userId).maybeSingle();
  if(profile.error)throw new Error(profile.error.message);
  const registration=await navigator.serviceWorker.getRegistration('/');
  const subscription=await registration?.pushManager.getSubscription();
  if(!subscription)return {name:(profile.data?.display_name||'') as PushName|'',enabled:false};
  const saved=await client.from('finance_push_subscriptions').select('id')
    .eq('space_id',spaceId).eq('user_id',userId).eq('endpoint',subscription.endpoint).maybeSingle();
  if(saved.error)throw new Error(saved.error.message);
  return {name:(profile.data?.display_name||'') as PushName|'',enabled:Boolean(saved.data)&&Notification.permission==='granted'};
}

async function activate(client:SupabaseClient,spaceId:string,name:PushName){
  // Pedir permiso directamente desde el toque: iPhone exige interacción del usuario.
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw new Error('El navegador no concedió permiso para las notificaciones.');
  const userId=await currentUser(client);
  const profile=await client.from('finance_push_profiles').upsert(
    {space_id:spaceId,user_id:userId,display_name:name},{onConflict:'space_id,user_id'});
  if(profile.error)throw new Error(profile.error.message);
  await navigator.serviceWorker.register('/push-sw.js',{scope:'/'});
  const registration=await navigator.serviceWorker.ready;
  const old=await registration.pushManager.getSubscription();
  if(old){
    const removed=await client.from('finance_push_subscriptions').delete()
      .eq('space_id',spaceId).eq('user_id',userId).eq('endpoint',old.endpoint);
    if(removed.error)throw new Error(removed.error.message);
    await old.unsubscribe();
  }
  const subscription=await registration.pushManager.subscribe({
    userVisibleOnly:true,applicationServerKey:keyBytes(vapidPublicKey),
  });
  const keys=subscription.toJSON().keys;
  if(!keys?.p256dh||!keys.auth){await subscription.unsubscribe();throw new Error('El navegador no entregó las claves de la suscripción.');}
  const saved=await client.from('finance_push_subscriptions').insert({
    space_id:spaceId,user_id:userId,endpoint:subscription.endpoint,
    p256dh:keys.p256dh,auth_key:keys.auth,
  });
  if(saved.error){await subscription.unsubscribe();throw new Error(saved.error.message);}
}

export async function disablePushOnThisDevice(client:SupabaseClient,spaceId:string){
  if(!supported())return;
  const userId=await currentUser(client);
  const registration=await navigator.serviceWorker.getRegistration('/');
  const subscription=await registration?.pushManager.getSubscription();
  if(!subscription)return;
  const removed=await client.from('finance_push_subscriptions').delete()
    .eq('space_id',spaceId).eq('user_id',userId).eq('endpoint',subscription.endpoint);
  if(removed.error)throw new Error(removed.error.message);
  await subscription.unsubscribe();
}

export function PushSettings({space}:{space:SharedSpace}){
  const [name,setName]=useState<PushName|''>('');
  const [enabled,setEnabled]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const available=Boolean(supabase&&vapidPublicKey&&supported());
  useEffect(()=>{
    if(!available||!supabase)return;
    let active=true;
    void readSettings(supabase,space.id).then(settings=>{
      if(active){setName(settings.name);setEnabled(settings.enabled)}
    }).catch(error=>{if(active)setMessage(error instanceof Error?error.message:'No se pudo consultar el estado.')});
    return()=>{active=false};
  },[available,space.id]);
  const chooseName=async(next:PushName|'')=>{
    setName(next);
    if(!next||!supabase)return;
    setBusy(true);setMessage('');
    try{
      const userId=await currentUser(supabase);
      const saved=await supabase.from('finance_push_profiles').upsert(
        {space_id:space.id,user_id:userId,display_name:next},{onConflict:'space_id,user_id'});
      if(saved.error)throw new Error(saved.error.message);
    }catch(error){setMessage(error instanceof Error?error.message:'No se pudo guardar tu nombre.');setName('')}
    finally{setBusy(false)};
  };
  const toggle=async()=>{
    if(!supabase||!available||busy)return;
    setBusy(true);setMessage('');
    try{
      if(enabled){await disablePushOnThisDevice(supabase,space.id);setEnabled(false);setMessage('Notificaciones desactivadas en este dispositivo.')}
      else if(name){await activate(supabase,space.id,name);setEnabled(true);setMessage('Notificaciones activadas en este dispositivo.')}
    }catch(error){setMessage(error instanceof Error?error.message:'No se pudieron configurar las notificaciones.')}
    finally{setBusy(false)};
  };
  return <section className="panel push-settings"><div className="section-head"><div><h2>Notificaciones de gastos</h2><p>Avisos de gastos personales del espacio compartido.</p></div></div>
    <label>Tu nombre en los avisos<select value={name} disabled={enabled||busy||!available} onChange={event=>void chooseName(event.target.value as PushName|'')}>
      <option value="">Elegí tu nombre</option><option value="Dorian">Dorian</option><option value="Dani">Dani</option>
    </select></label>
    <button className="small-add" disabled={!available||busy||(!enabled&&!name)} onClick={()=>void toggle()}>
      {busy?'Un momento…':enabled?'Desactivar notificaciones':'Activar notificaciones'}
    </button>
    <p className="form-hint">{enabled?'Activadas en este dispositivo.':'Cada dispositivo se activa por separado.'} En iPhone, primero agregá Duo Finance a la pantalla de inicio y abrila desde allí.</p>
    {!available&&<p className="form-hint">Pendiente de configurar Web Push o navegador no compatible.</p>}
    {message&&<p role="status" className="form-hint">{message}</p>}
  </section>;
}
