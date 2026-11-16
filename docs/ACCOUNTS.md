# Accounts: setup guide

Sign-up / sign-in uses **Supabase Auth** (email + password, email verification) with a
**Cloudflare Turnstile** CAPTCHA. Player names are shown as `nickname#tag`, e.g. `Dizzt#3942`.

Without this setup the game still runs; the account screen just says accounts aren't available.

## What gets stored

| Field | Where | Notes |
|---|---|---|
| UID | `auth.users.id` (= `profiles.id`) | uuid |
| Email | `auth.users.email` | private, never exposed through `profiles` |
| Password | `auth.users.encrypted_password` | bcrypt hash; the plain password is never stored |
| Sign-up date/time | `auth.users.created_at`, copied to `profiles.created_at` | `timestamptz`, UTC |
| Email verified at | `auth.users.email_confirmed_at` | set when the link is clicked |
| Nickname | `profiles.nickname` | 1–32 bytes UTF-8 (e.g. 10 Korean characters), no `#` |
| Tag | `profiles.discriminator` | 1–9999, shown as 4 digits (`0042`) |

Tag rules (enforced in the database, not just the UI):

- Picked **at random** among the numbers still free for that nickname.
- `nickname + tag` is **unique**, compared case-insensitively (`Dizzt#0001` and `dizzt#0001` can't both exist).
- So each nickname can be used by up to **9999** players. The 10000th sign-up with that nickname is rejected.
- Only the database assigns tags (sign-up trigger, `security definer`); clients can read profiles but can't write them.

## 1. Run the database migration

Supabase Dashboard → **SQL Editor** → paste and run
[`supabase/migrations/20261117000000_profiles.sql`](../supabase/migrations/20261117000000_profiles.sql).

(With the Supabase CLI linked to the project, `supabase db push` does the same.)

## 2. Auth settings

Supabase Dashboard → **Authentication**:

- **Sign In / Providers → Email**: enabled, **Confirm email: ON**.
- **Sign In / Providers → Email → Minimum password length**: 8 (the form also requires letters + numbers).
- **URL Configuration**
  - **Site URL**: your deployed game URL (e.g. `https://you.github.io/AvoidNSurviveMaker/`)
  - **Redirect URLs**: add the same URL and `http://localhost:5173/` for local testing.
    The verification email sends players back to the page they signed up from.
- **Emails → SMTP**: the built-in mailer is rate-limited to a handful of emails per hour and is
  meant for testing. Set up a custom SMTP provider before real players sign up.

## 3. CAPTCHA (Cloudflare Turnstile)

1. Cloudflare Dashboard → **Turnstile** → **Add widget**. Add your domains (and `localhost`).
   You get a **site key** (public) and a **secret key**.
2. Supabase Dashboard → **Authentication → Attack Protection** → enable **CAPTCHA protection**,
   provider **Turnstile**, paste the **secret key**.
3. Put the **site key** in `.env.local` (below).

When CAPTCHA protection is on, Supabase requires a token for sign-up, sign-in and resending the
verification email; the game shows the widget on all three.

For local testing you can use Cloudflare's always-pass test keys:
site key `1x00000000000000000000AA`, secret key `1x0000000000000000000000000000000AA`.
Don't leave the test secret in production.

## 4. Connect the game

Copy `.env.example` to `.env.local` (git-ignored) and fill in:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable / anon key>   # Project Settings → API
VITE_TURNSTILE_SITE_KEY=<turnstile site key>
```

The publishable (anon) key is meant to be public; row level security protects the data.
**Never** put the `service_role` / secret key in the game.

Restart `run-dev.bat` (or `npm run dev`) after changing `.env.local`.

## Flow

1. **Create Account**: email, password (+ confirm), nickname, CAPTCHA. The form checks the rules
   and asks the server how many tags are left for the nickname before submitting.
2. The database creates the profile with a random tag in the same transaction as the account.
3. **Check your email** screen: the player clicks the link in the email (resend available after 60 s).
4. The link returns to the game; the player is signed in and greeted as `Nickname#1234`.
   If the link is opened in another browser, the email is still verified and the player signs in normally.
5. **Sign In** before verifying shows "Please verify your email first" with a resend button.
