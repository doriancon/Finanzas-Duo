import { createClient } from '@supabase/supabase-js';
import { deleteFinanceAccount } from '../server/delete-account.mjs';

const PROJECT_URL = 'https://ueobsnszhtdcywppheoq.supabase.co';
const serverAuth = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export default {
  async fetch(request) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return new Response('Forbidden', { status: 403 });
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return new Response('Invalid request', { status: 400 });
    const publishable = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const secret = process.env.DUO_ACCOUNT_DELETE_SUPABASE_SECRET_KEY;
    if (process.env.DUO_ACCOUNT_DELETION_ENABLED !== 'true' || !publishable || !secret)
      return new Response('La eliminación de cuentas todavía no está habilitada.', { status: 503 });
    const authorization = request.headers.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return new Response('Unauthorized', { status: 401 });
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 4096) return new Response('Invalid request', { status: 400 });
      body = JSON.parse(raw);
    } catch { return new Response('Invalid request', { status: 400 }); }
    try {
      const userClient = createClient(PROJECT_URL, publishable, serverAuth);
      const verificationClient = createClient(PROJECT_URL, publishable, serverAuth);
      const adminClient = createClient(PROJECT_URL, secret, serverAuth);
      const result = await deleteFinanceAccount({ userClient, verificationClient, adminClient,
        token, password: body?.password, confirmation: body?.confirmation });
      return Response.json({ message: result.message }, { status: result.status });
    } catch {
      // No devolver errores de Auth/SQL ni credenciales al navegador.
      return Response.json({ message: 'No se pudo completar la eliminación. Tu cuenta sigue activa; intentá más tarde.' }, { status: 500 });
    }
  },
};
