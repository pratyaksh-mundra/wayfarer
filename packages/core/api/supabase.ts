import { createClient } from '@supabase/supabase-js'

// Supabase client shared between web and future React Native app.
// No Next.js-specific imports here — this file must stay platform-agnostic.

// Use SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) — set this to your proxy if applicable,
// e.g. https://wayfarer.jiobase.com instead of the raw https://[ref].supabase.co
const supabaseUrl =
  process.env['SUPABASE_URL'] ??
  process.env['NEXT_PUBLIC_SUPABASE_URL']

// Supabase renamed "anon key" to "publishable key" in newer projects.
// All three names are checked so both project generations work.
const supabaseAnonKey =
  process.env['SUPABASE_ANON_KEY'] ??
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ??
  process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY']

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase credentials. Set SUPABASE_URL and one of: SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Server-side only client with service role key — never expose to client bundles
export function createServiceClient() {
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY — only use this server-side')
  }
  return createClient(supabaseUrl!, serviceRoleKey)
}
