// src/lib/supabaseAdmin.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// This client is for SERVER USE ONLY (API routes, edge functions, etc.)
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing server Supabase env vars (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).');
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
  },
});
