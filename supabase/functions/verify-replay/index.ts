// verifier.js is generated from the same simulation and official maps as the browser.
import { verifyReplay, MAX_REPLAY_BYTES } from './verifier.js';

const url = Deno.env.get('SUPABASE_URL')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const origins = (Deno.env.get('REPLAY_ALLOWED_ORIGINS') ?? '').split(',').map(v => v.trim()).filter(Boolean);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  const headers = new Headers({ 'Content-Type': 'application/json', 'Vary': 'Origin' });
  if (origins.includes(origin)) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (origin && !origins.includes(origin)) return reply(403, { error: 'ORIGIN_NOT_ALLOWED' });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return reply(401, { error: 'NOT_AUTHENTICATED' });
  try {
    // Resolve the caller with Auth; never trust a body user_id or decode an unsigned JWT.
    const auth = await fetch(`${url}/auth/v1/user`, { headers: { apikey: service, Authorization: authorization } });
    if (!auth.ok) return reply(401, { error: 'NOT_AUTHENTICATED' });
    const user = await auth.json();
    if (!user.id) return reply(401, { error: 'NOT_AUTHENTICATED' });
    const rpc = async (name: string, body: unknown) => fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const claim = await rpc('claim_replay_verification', { p_user: user.id });
    if (!claim.ok) return reply(503, { error: 'VERIFIER_UNAVAILABLE' });
    if (!(await claim.json())) return reply(429, { error: 'RATE_LIMITED' });
    // Enforce actual streamed bytes, not just Content-Length.
    if (!req.body) return reply(400, { error: 'INVALID_REPLAY' });
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REPLAY_BYTES) { await reader.cancel(); return reply(413, { error: 'REPLAY_TOO_LARGE' }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let body;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reply(400, { error: 'INVALID_REPLAY' }); }
    let result;
    try { result = verifyReplay(body?.key, body?.replay); }
    catch (err) { return reply(422, { error: (err as Error).message }); }
    const saved = await rpc('store_verified_record', {
      p_user: user.id, p_key: body.key, p_ms: result.best_ms, p_stars: result.stars, p_crystal: result.crystal,
    });
    if (!saved.ok) return reply(503, { error: 'SAVE_FAILED' });
    return reply(200, { ok: true, ...result });
  } catch {
    return reply(503, { error: 'VERIFIER_UNAVAILABLE' });
  }
});
