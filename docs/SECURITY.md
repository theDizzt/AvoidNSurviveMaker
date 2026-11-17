# Security boundaries

## Untrusted imports

Shared map input is capped at 20,000,000 bytes before JSON parsing. Compressed
shares are consumed incrementally and cancelled when decoded output exceeds the
budget. Encoded input is also capped before base64 decoding.

Theme ZIP imports run in a dedicated worker with a 15-second timeout. Limits:
30 MiB compressed, 30 MiB per decoded entry, 60 MiB total decoded data, and 2048
entries. Limits count actual output, not only ZIP header sizes. Unsafe paths and
duplicate paths are rejected. Small compressed chunks bound temporary inflate
output. These limits apply to all entries, including unused assets.

## Database deployment

After the previous four migrations, apply
[`20261118000000_security_hardening.sql`](../supabase/migrations/20261118000000_security_hardening.sql).
This repository change alone does not update a deployed Supabase database.

- Full profiles are readable only by their owner. `public_profiles` exposes only
  `id`, `nickname`, and `discriminator`, intentionally through a view owned by the
  migration role. Activity timestamps and play duration are not public.
- Direct client writes to profiles and records are revoked. RPCs authenticate the
  caller and fix the search path.
- Play-time updates lock the profile row and consume a server-time budget, with
  no repeatable grace bonus. At most one hour of unclaimed time is available.
  This bounds inflation; a browser still cannot prove it was visible or actively
  playing. Existing inflated totals are not rewritten automatically.
- Record submissions are limited to 1 MiB, 2000 entries per batch, and 2000 stored
  records per account. Per-account locking prevents concurrent quota bypass.
  Keys must match the theme ID / index format. Invalid entries are ignored;
  exceeding the account quota rejects the entire batch. Existing rows are retained.
- All existing and newly submitted browser records are **unverified personal
  backups**. `verified` defaults to false and cannot be changed by clients.
  An improvement submitted by a browser clears any previous verification flag.
  Do not build rankings, rewards, or access control from these rows. A future
  trusted verifier must load the authoritative map/version, validate and replay
  bounded input, and derive times and stars itself before publishing records.

Server-side CAPTCHA, email confirmation, request rate limits, and production
grants must also be configured in Supabase. They are not controlled by the web
bundle. Never put a service-role secret in a `VITE_` environment variable.

## Regression checks

`npm test` includes adversarial compressed shares, falsified ZIP size headers,
expanded size/count limits, unsafe paths, and normal ZIP/share round trips.

To test the SQL in an isolated, in-memory PostgreSQL engine without credentials:

```sh
npm install --prefix temp/security-db --no-save --package-lock=false @electric-sql/pglite
node scripts/security-db.test.mjs
```

The temporary runtime is gitignored and is not an application dependency. Tests
apply every migration, emulate Supabase roles and `auth.uid()`, and check RLS,
public view columns, RPC permissions, repeated play-time reports, quota rollback,
input limits, and unverified record handling. Real Supabase deployment settings
and concurrent requests should still be checked in staging.
