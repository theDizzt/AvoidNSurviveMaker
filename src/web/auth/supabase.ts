import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();

/**
 * Supabase client, or null when configuration is missing or invalid.
 * The game itself works without it; only accounts are unavailable.
 *
 * PKCE flow: the email verification link comes back as `?code=...` (query string),
 * which keeps the URL hash free for share links (`#m=...`).
 */
function configuredClient(): SupabaseClient | null {
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Unsupported Supabase URL protocol');
    }
    return createClient(url, key, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
    });
  } catch {
    // Account configuration must never prevent the offline game from starting.
    // Do not log the supplied URL/key: configuration can contain sensitive data.
    console.warn('Account setup is invalid. Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the deployment environment. Offline play is available.');
    return null;
  }
}

export const supabase: SupabaseClient | null = configuredClient();

export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? '';
