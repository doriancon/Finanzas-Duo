import { createClient } from '@supabase/supabase-js';

export const TEST_PROJECT_REF = 'ueobsnszhtdcywppheoq';
export const TEST_PROJECT_URL = `https://${TEST_PROJECT_REF}.supabase.co`;

// La clave publicable (anon) habilita RLS; jamás usar service_role en Vite.
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const supabaseConfigured = Boolean(publishableKey);
export const supabase = publishableKey
  ? createClient(TEST_PROJECT_URL, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
