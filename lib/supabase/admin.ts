// Service-role Supabase client — BYPASSES RLS. Server-only. Used to call the
// SECURITY DEFINER engine functions (check_in, join_queue, ...) after a server
// action has authenticated the caller and resolved their household, and by the
// cron sweep + import. NEVER import this into a client component.
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
