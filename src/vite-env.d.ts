/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** https://<project-ref>.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Publishable (anon) key — safe to ship to browsers; RLS protects the data */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Older name for the same key */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Cloudflare Turnstile site key (public) */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
