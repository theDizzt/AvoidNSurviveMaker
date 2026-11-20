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
    create role anon; create role authenticated; create role service_role;
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

  await db.exec('reset role');
  await db.exec(await readFile(new URL('../supabase/migrations/20261118010000_deaths.sql', import.meta.url), 'utf8'));
  await asUser(a);
  const addDeaths = (total, levels) => scalar('select public.add_deaths($1, $2::jsonb)', [total, JSON.stringify(levels)]);
  assert.equal(Number(await addDeaths(3, [{ key: 'workshop/0', count: 2 }])), 3);
  // The total never trails the level counts; malformed entries are skipped
  assert.equal(Number(await addDeaths(0, [
    { key: 'workshop/0', count: 1 }, { key: '../x', count: 5 }, { key: 'x/999', count: 5 },
    { key: 'x/1', count: 1.5 }, { key: 'x/2', count: 0 }, { key: 'x/3', count: 'bad' }, null,
  ])), 4);
  assert.equal(Number(await scalar("select deaths from public.level_deaths where level_key = 'workshop/0'")), 3);
  assert.equal(Number(await scalar('select count(*) from public.level_deaths')), 1);
  await assert.rejects(addDeaths(-1, []), /INVALID_DEATHS/);
  await assert.rejects(addDeaths(10001, []), /INVALID_DEATHS/);
  await assert.rejects(db.query("select public.add_deaths(1, '{}'::jsonb)"), /INVALID_DEATHS/);
  await assert.rejects(addDeaths(1, Array(201).fill({})), /TOO_MANY_DEATHS/);
  await assert.rejects(db.query('update public.profiles set total_deaths = 0'), /permission denied/);
  await assert.rejects(db.query("insert into public.level_deaths (user_id, level_key, deaths) values ($1, 'w/0', 1)", [a]), /permission denied/);
  await assert.rejects(db.query('select total_deaths from public.public_profiles'), /does not exist/);
  await asUser(b);
  assert.equal(Number(await scalar('select count(*) from public.level_deaths')), 0);
  assert.equal(Number(await scalar('select total_deaths from public.profiles')), 0);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query("select public.add_deaths(1, '[]'::jsonb)"), /permission denied/);
  await assert.rejects(db.query('select * from public.level_deaths'), /permission denied/);
  console.log('PASS: deaths only add, stay private, and reject malformed or oversized reports');

  await db.exec('reset role');
  await db.exec(await readFile(new URL('../supabase/migrations/20261118020000_leaderboard.sql', import.meta.url), 'utf8'));
  // A has an unverified workshop/0 record (100 ms); B gets a verified one, then A's is verified too
  await db.query("insert into public.level_records (user_id, level_key, best_ms, stars, verified) values ($1, 'workshop/0', 150, 2, true)", [b]);
  await asUser(a);
  const board = async (key, limit = 10) => (await db.query('select * from public.level_leaderboard($1, $2)', [key, limit])).rows;
  let rows = await board('workshop/0');
  assert.deepEqual(rows.map((r) => [Number(r.place), r.nickname, r.is_me]), [[1, 'Security B', false]]);
  await db.exec('reset role');
  await db.query("update public.level_records set verified = true where user_id = $1 and level_key = 'workshop/0'", [a]);
  await asUser(a);
  rows = await board('workshop/0');
  assert.deepEqual(rows.map((r) => [Number(r.place), r.nickname, r.best_ms, r.is_me]), [[1, 'Security A', 100, true], [2, 'Security B', 150, false]]);
  // Outside the top places, the caller's own row is still returned
  rows = await board('workshop/0', 1);
  assert.equal(rows.length, 1);
  await asUser(b);
  rows = await board('workshop/0', 1);
  assert.deepEqual(rows.map((r) => [Number(r.place), r.is_me]), [[1, false], [2, true]]);
  assert.equal(Object.keys(rows[0]).includes('user_id'), false);
  assert.equal((await board('custom:pack/998')).length, 0); // custom pack keys are never ranked
  assert.equal((await board('last/0')).length, 0); // unverified only: empty
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role anon");
  assert.equal((await board('workshop/0')).length, 2);
  assert.ok((await board('workshop/0')).every((r) => r.is_me === false));
  console.log('PASS: leaderboards rank verified records only, are public, and expose no user ids');

  // Temporary: every record counts as verified
  await db.exec('reset role');
  await db.exec(await readFile(new URL('../supabase/migrations/20261118030000_records_always_verified.sql', import.meta.url), 'utf8'));
  assert.equal(Number(await scalar('select count(*) from public.level_records where not verified')), 0);
  await asUser(b);
  await submit([{ key: 'workshop/1', best_ms: 500, stars: 2 }]);
  await submit([{ key: 'workshop/1', best_ms: 400, stars: 3 }]); // an improvement stays verified
  assert.equal(await scalar("select verified from public.level_records where level_key = 'workshop/1'"), true);
  rows = await board('workshop/1');
  assert.deepEqual(rows.map((r) => [Number(r.place), r.best_ms, r.is_me]), [[1, 400, true]]);
  await assert.rejects(db.query('update public.level_records set verified = false'), /permission denied/);
  console.log('PASS: records-always-verified: existing and new records are ranked; clients still cannot write directly');
  await db.exec('reset role');
  await db.exec(await readFile(new URL('../supabase/migrations/20261118040000_public_profiles_invoker.sql', import.meta.url), 'utf8'));
  assert.equal(await scalar("select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.public_profiles'::regclass"), true);
  const c = '00000000-0000-0000-0000-000000000003';
  await db.query('insert into auth.users (id, raw_user_meta_data) values ($1, $2)', [c, { nickname: 'Security C' }]);
  await db.query('update public.profiles set nickname = $1 where id = $2', ['Renamed C', c]);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    assert.equal(Number(await scalar('select count(*) from public.public_profiles')), 3);
    assert.equal(await scalar('select nickname from public.public_profiles where id = $1', [c]), 'Renamed C');
    await assert.rejects(db.query('select total_play_seconds from public.profile_directory'), /does not exist/);
    await assert.rejects(db.query("update public.public_profiles set nickname = 'Forged'"), /permission denied/);
    await assert.rejects(db.query('delete from public.profile_directory'), /permission denied/);
    await assert.rejects(db.query('insert into public.profile_directory (id, nickname, discriminator) values ($1, $2, 1)', [c, 'Forged']), /permission denied/);
    assert.equal(await scalar("select has_function_privilege(current_user, 'public.sync_profile_directory()', 'EXECUTE')"), false);
  }
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select * from public.profiles'), /permission denied/);
  await asUser(a);
  assert.equal(Number(await scalar('select count(*) from public.profiles')), 1);
  await db.exec('reset role');
  await db.query('delete from auth.users where id = $1', [c]);
  await db.exec('set role anon');
  assert.equal(Number(await scalar('select count(*) from public.public_profiles')), 2);
  console.log('PASS: invoker public profiles preserve privacy, reject writes, and sync identity lifecycle');
  await db.exec('reset role');
  await db.exec(await readFile(new URL('../supabase/migrations/20261119000000_hide_public_profile_ids.sql', import.meta.url), 'utf8'));
  await db.query('insert into auth.users (id, raw_user_meta_data) values ($1, $2)', [c, { nickname: 'Security C' }]);
  await db.query('update public.profiles set nickname = $1 where id = $2', ['Renamed C', c]);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    const tags = (await db.query('select * from public.public_profiles')).rows;
    assert.equal(tags.length, 3);
    assert.deepEqual(Object.keys(tags[0]).sort(), ['discriminator', 'nickname']);
    assert.ok(tags.some((r) => r.nickname === 'Renamed C'));
    assert.equal((await db.query('select nickname, discriminator from public.profile_directory')).rows.length, 3);
    await assert.rejects(db.query('select id from public.public_profiles'), /does not exist/);
    await assert.rejects(db.query('select id from public.profile_directory'), /permission denied/);
    await assert.rejects(db.query('select * from public.profile_directory'), /permission denied/);
    await assert.rejects(db.query('select nickname from public.profile_directory where id = $1', [c]), /permission denied/);
    await assert.rejects(db.query("update public.public_profiles set nickname = 'Forged'"), /permission denied/);
    await assert.rejects(db.query('delete from public.profile_directory'), /permission denied/);
    const leaderboard = await board('workshop/0');
    assert.equal(leaderboard.length, 2);
    assert.ok(leaderboard.every((r) => !('id' in r) && !('user_id' in r)));
  }
  await asUser(a);
  assert.equal(await scalar('select id from public.profiles'), a);
  await db.exec('reset role');
  await db.query('delete from auth.users where id = $1', [c]);
  await db.exec('set role anon');
  assert.equal(Number(await scalar('select count(*) from public.public_profiles')), 2);
  console.log('PASS: public UUID access blocked through view and table; tags, lifecycle, own profile and leaderboard preserved');
  await db.exec('reset role; grant usage on schema public to service_role');
  for (const migration of ['20261119010000_achievements.sql', '20261120000000_crystal_stars.sql', '20261120010000_verified_replays.sql',
    '20261121000000_achievement_int_ids.sql', '20261121010000_drop_replay_verification.sql',
    '20261121020000_drop_public_profiles.sql', '20261121030000_leaderboard_across_versions.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
  }
  // No replay verification: its tables and functions are gone
  for (const name of ['verified_level_records', 'replay_verification_limits', 'achievement_definitions', 'public_profiles']) {
    assert.equal(await scalar('select to_regclass($1) is null', [`public.${name}`]), true);
  }
  const versionedKey = `workshop/0@${'a'.repeat(64)}`;
  await asUser(b);
  await submit([{ key: versionedKey, best_ms: 30, stars: 3, crystal: true }]);
  await submit([{ key: `custom:pack/${'c'.repeat(8)}@${'c'.repeat(64)}`, best_ms: 5, stars: 3 }]);
  // Own records rank directly; custom keys never do
  assert.equal((await board(versionedKey))[0].best_ms, 30);
  assert.equal((await board(`custom:pack/${'c'.repeat(8)}@${'c'.repeat(64)}`)).length, 0);
  // Another revision of the same level, and the old slot key, share one board
  assert.equal((await board(`workshop/0@${'b'.repeat(64)}`))[0].best_ms, 30);
  assert.equal((await board('workshop/0'))[0].best_ms, 30);
  await addDeaths(1, [{ key: versionedKey, count: 1 }]);
  assert.equal(Number(await scalar('select deaths from public.level_deaths where level_key = $1', [versionedKey])), 1);
  console.log('PASS: replay verification removed; leaderboards rank official records');

  // Unversioned keys: duplicate rows of one level merge into "<theme>/<id>"
  await db.exec('reset role');
  await db.query("insert into public.level_records (user_id, level_key, best_ms, stars, crystal) values ($1, 'workshop/0', 50, 2, false) on conflict do nothing", [b]);
  await db.query(`insert into public.level_records (user_id, level_key, best_ms, stars, crystal) values ($1, $2, 40, 1, false)`, [b, `workshop/0@${'b'.repeat(64)}`]);
  await db.query("insert into public.level_deaths (user_id, level_key, deaths) values ($1, 'workshop/0', 2) on conflict do nothing", [b]);
  await db.exec(await readFile(new URL('../supabase/migrations/20261121040000_unversioned_level_keys.sql', import.meta.url), 'utf8'));
  assert.equal(Number(await scalar("select count(*) from public.level_records where position('@' in level_key) > 0")), 0);
  assert.equal(Number(await scalar("select count(*) from public.level_deaths where position('@' in level_key) > 0")), 0);
  const merged = (await db.query("select best_ms, stars, crystal from public.level_records where user_id = $1 and level_key = 'workshop/0'", [b])).rows[0];
  assert.deepEqual([merged.best_ms, merged.stars, merged.crystal], [30, 3, true]);
  assert.equal(Number(await scalar("select deaths from public.level_deaths where user_id = $1 and level_key = 'workshop/0'", [b])), 3);
  // Old clients still send the suffix; it is dropped on the way in
  await asUser(b);
  await submit([{ key: `workshop/1@${'e'.repeat(64)}`, best_ms: 700, stars: 2 }]);
  await submit([{ key: 'custom:pack/my-level', best_ms: 700, stars: 2 }]);
  await addDeaths(1, [{ key: `workshop/1@${'e'.repeat(64)}`, count: 1 }]);
  await db.exec('reset role');
  assert.equal(Number(await scalar("select count(*) from public.level_records where user_id = $1 and level_key in ('workshop/1', 'custom:pack/my-level')", [b])), 2);
  assert.equal(Number(await scalar("select deaths from public.level_deaths where user_id = $1 and level_key = 'workshop/1'", [b])), 1);
  assert.equal((await board(`workshop/0@${'f'.repeat(64)}`))[0].best_ms, 30);
  console.log('PASS: level keys without content hashes; duplicates merged, old clients normalized');

  // Achievements v2: integer ids, rules inside refresh_achievements()
  await asUser(b);
  const ids = async () => (await db.query('select achievement_id from public.refresh_achievements() order by 1')).rows.map(r => r.achievement_id);
  // workshop/0: 3 stars + crystal = 4 stars, 30 ms <= 35 ms
  assert.deepEqual(await ids(), [14]);
  await submit(Array.from({ length: 4 }, (_, i) => ({ key: `desert/${i}@${'d'.repeat(64)}`, best_ms: 900, stars: 3 })));
  assert.deepEqual(await ids(), [1, 14]); // 16 stars
  await db.query('select public.claim_discord_achievement()');
  assert.deepEqual(await ids(), [1, 12, 14]);
  await assert.rejects(db.query('insert into public.user_achievements (user_id, achievement_id) values ($1, 2)', [b]), /permission denied/);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select public.claim_discord_achievement()'), /permission denied/);
  console.log('PASS: achievements v2 issue by integer id from records, Discord claim needs an account');
} finally {
  await db.close();
}
