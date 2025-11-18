// src/lib/legacyUser.ts
import { supabaseAdmin } from './supabaseAdmin';

export async function getOrCreateLegacyUserId(email: string, name?: string): Promise<string> {
  if (!email) {
    throw new Error('Email is required to resolve legacy user id');
  }

  // 1) Try to find existing legacy user by email
  const { data: existing, error: selectError } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    console.error('Error looking up legacy user by email:', selectError);
    throw selectError;
  }

  if (existing?.id) {
    return existing.id;
  }

  // 2) If not found, create a new legacy user row
  const { data: created, error: insertError } = await supabaseAdmin
    .from('users')
    .insert({
      email,
      name: name || email,
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('Error creating legacy user row:', insertError);
    throw insertError;
  }

  return created.id;
}
