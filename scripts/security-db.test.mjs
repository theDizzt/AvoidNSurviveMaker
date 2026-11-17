// Isolated PostgreSQL regression tests. See docs/SECURITY.md for setup.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../temp/security-db/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
const a = '00000000-0000-0000-0000-000000000001';
const b = '00000000-0000-0000-0000-000000000002';
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const asUser = async (id) => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec('set role authenticated');
};
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb,
      created_at timestamptz not null default now());
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const migration of [
    '20261117000000_profiles.sql', '20261117010000_play_time.sql',
    '20261117020000_play_time_seconds.sql', '20261117030000_level_records.sql',
  ]) await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
  await db.query(`insert into auth.users (id, raw_user_meta_data, created_at) values
    ($1, '{"nickname":"Security A"}', now() - interval '1 hour'),
    ($2, '{"nickname":"Security B"}', now() - interval '1 hour')`, [a, b]);
  await db.query("insert into public.level_records (user_id, level_key, best_ms, stars) values ($1, 'workshop/0', 123, 2)", [a]);
  await db.exec(await readFile(new URL('../supabase/migrations/20261118000000_security_hardening.sql', import.meta.url), 'utf8'));
  assert.equal(await scalar('select verified from public.level_records'), false);
  console.log('PASS: all migrations apply; historical records remain unverified');

  await asUser(a);
  assert.equal(await scalar('select count(*) from public.profiles'), 1);
  assert.equal(await scalar('select count(*) from public.public_profiles'), 2);
  assert.equal(await scalar('select count(*) from public.level_records'), 1);
  await assert.rejects(db.query('select total_play_seconds from public.public_profiles'), /does not exist/);
  await assert.rejects(db.query('update public.profiles set total_play_seconds = 999999'), /permission denied/);
  await assert.rejects(db.query('update public.level_records set verified = true'), /permission denied/);
  await asUser(b);
  assert.equal(await scalar('select count(*) from public.level_records'), 0);
  await db.exec('reset role; set role anon');
  assert.equal(await scalar('select count(*) from public.public_profiles'), 2);
  await assert.rejects(db.query('select * from public.profiles'), /permission denied/);
  await assert.rejects(db.query('select public.add_play_time(30)'), /permission denied/);
  await assert.rejects(db.query("select * from public.submit_level_records('[]')"), /permission denied/);
  console.log('PASS: public identity projection, private activity, owner-only records, no direct writes');

  await db.exec('reset role');
  await db.query("update public.profiles set total_play_seconds = 0, last_play_report_at = clock_timestamp() - interval '10 seconds' where id = $1", [a]);
  await asUser(a);
  const started = Date.now();
  const first = await scalar('select public.add_play_time(3600)');
  assert.ok(first >= 10 && first <= 11);
  for (let i = 0; i < 30; i++) await db.query('select public.add_play_time(3600)');
  const total = await scalar('select total_play_seconds from public.profiles');
  assert.ok(total <= 11 + Math.ceil((Date.now() - started) / 1000), `inflated total: ${total}`);
  assert.equal(await scalar('select public.add_play_time(-1)'), total);
  await db.exec('reset role');
  await db.query("update public.profiles set total_play_seconds = 0, last_play_report_at = null, created_at = clock_timestamp() - interval '2 seconds' where id = $1", [a]);
  await asUser(a);
  const initial = await scalar('select public.add_play_time(3600)');
  assert.ok(initial >= 2 && initial <= 3, `initial report inflated: ${initial}`);
  console.log('PASS: rapid repeated requests and initial reports cannot mint play time');

  const submit = (records) => db.query('select * from public.submit_level_records($1::jsonb)', [JSON.stringify(records)]);
  await submit([{ key: 'custom:pack/998', best_ms: 50, stars: 3, verified: true }]);
  assert.equal(await scalar("select verified from public.level_records where level_key = 'custom:pack/998'"), false);
  await submit([
    { key: 'x/999', best_ms: 1, stars: 3 }, { key: '../x', best_ms: 1, stars: 3 },
    { key: 'x/1', best_ms: 'bad', stars: 3 }, { key: 'x/2', best_ms: 1e30, stars: 3 },
    { key: 'x/3', best_ms: 1.5, stars: 3 }, { key: 'x/4', best_ms: 1, stars: 4 }, null,
  ]);
  assert.equal(await scalar('select count(*) from public.level_records'), 2);
  await assert.rejects(submit({}), /INVALID_RECORDS/);
  await assert.rejects(submit(Array(2001).fill({})), /TOO_MANY_RECORDS/);
  await assert.rejects(submit([{ padding: 'a'.repeat(1048576) }]), /TOO_MANY_RECORDS/);
  console.log('PASS: malformed and oversized submissions rejected; verification flag cannot be forged');

  await db.exec('reset role');
  await db.query(`insert into public.level_records (user_id, level_key, best_ms, stars)
    select $1, 'custom:quota' || (i / 999)::text || '/' || (i % 999)::text, 100, 1
    from generate_series(0, 1996) i`, [a]);
  await asUser(a);
  await submit([{ key: 'last/0', best_ms: 100, stars: 1 }]);
  assert.equal(await scalar('select count(*) from public.level_records'), 2000);
  await assert.rejects(submit([
    { key: 'workshop/0', best_ms: 1, stars: 3 }, { key: 'overflow/0', best_ms: 1, stars: 3 },
  ]), /RECORD_QUOTA_EXCEEDED/);
  assert.equal(await scalar("select best_ms from public.level_records where level_key = 'workshop/0'"), 123);
  await submit([{ key: 'workshop/0', best_ms: 100, stars: 3 }]);
  assert.equal(await scalar('select count(*) from public.level_records'), 2000);
  assert.equal(await scalar("select best_ms from public.level_records where level_key = 'workshop/0'"), 100);
  console.log('PASS: account quota is atomic; existing records can still improve at the limit');
} finally {
  await db.close();
}
