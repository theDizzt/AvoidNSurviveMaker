# 계정: 설정 가이드

가입 / 로그인은 **Supabase Auth**(이메일 + 비밀번호, 이메일 인증)와 **Cloudflare Turnstile** CAPTCHA 를 사용합니다. 플레이어 이름은 `nickname#tag` 형식으로 표시됩니다(예: `Dizzt#3942`).

이 설정을 하지 않아도 게임은 동작하며, 계정 화면에 계정 기능을 쓸 수 없다고 표시될 뿐입니다.

## 저장되는 정보

| 항목 | 위치 | 비고 |
|---|---|---|
| UID | `auth.users.id` (= `profiles.id`) | uuid |
| 이메일 | `auth.users.email` | 비공개, `profiles` 로는 노출되지 않음 |
| 비밀번호 | `auth.users.encrypted_password` | bcrypt 해시. 평문 비밀번호는 저장하지 않음 |
| 가입 일시 | `auth.users.created_at`, `profiles.created_at` 에 복사 | `timestamptz`, UTC |
| 이메일 인증 일시 | `auth.users.email_confirmed_at` | 링크를 클릭하면 설정됨 |
| 닉네임 | `profiles.nickname` | UTF-8 1–32바이트 (예: 한글 10자), `#` 불가 |
| 태그 | `profiles.discriminator` | 1–9999, 4자리로 표시 (`0042`) |
| 총 플레이 시간 | `profiles.total_play_seconds` (초), `profiles.play_time` (`hh:mm:ss`) | 게임을 켜 둔 총 시간 (로그인 상태, 탭이 보이는 동안) |
| 레벨 기록 | `level_records` (`level_key`, `best_ms`, `stars`) | 레벨별 최고 클리어 시간(ms)과 최다 별. 본인만 읽을 수 있음 |
| 사망 횟수 | `profiles.total_deaths`, `level_deaths` (`level_key`, `deaths`) | 전체와 레벨별 사망 횟수. 본인만 읽을 수 있음 |

태그 규칙 (UI 뿐 아니라 데이터베이스에서 강제됩니다):

- 해당 닉네임에서 아직 비어 있는 번호 중 **무작위**로 고릅니다.
- `nickname + tag` 는 대소문자 구분 없이 **유일**합니다 (`Dizzt#0001` 과 `dizzt#0001` 은 동시에 존재할 수 없음).
- 따라서 닉네임 하나를 최대 **9999명**이 쓸 수 있습니다. 같은 닉네임으로 10000번째 가입은 거부됩니다.
- 태그는 데이터베이스만 부여합니다(가입 트리거, `security definer`). 클라이언트는 프로필을 읽을 수만 있고 쓸 수 없습니다.

## 1. 데이터베이스 마이그레이션 실행

Supabase Dashboard → **SQL Editor** → 아래 파일을 순서대로 붙여 넣고 실행합니다.

1. [`supabase/migrations/20261117000000_profiles.sql`](../supabase/migrations/20261117000000_profiles.sql) — 프로필, 닉네임 태그
2. [`supabase/migrations/20261117010000_play_time.sql`](../supabase/migrations/20261117010000_play_time.sql) — 총 플레이 시간
3. [`supabase/migrations/20261117020000_play_time_seconds.sql`](../supabase/migrations/20261117020000_play_time_seconds.sql) — 플레이 시간을 초 단위로 저장
4. [`supabase/migrations/20261117030000_level_records.sql`](../supabase/migrations/20261117030000_level_records.sql) — 레벨별 최고 시간(ms)과 별
5. [`supabase/migrations/20261118000000_security_hardening.sql`](../supabase/migrations/20261118000000_security_hardening.sql) — 비공개 프로필, 미검증 기록
6. [`supabase/migrations/20261118010000_deaths.sql`](../supabase/migrations/20261118010000_deaths.sql) — 사망 횟수 (전체, 레벨별)
7. [`supabase/migrations/20261118020000_leaderboard.sql`](../supabase/migrations/20261118020000_leaderboard.sql) — 레벨별 순위표 (검증된 기록만)
8. [`supabase/migrations/20261118030000_records_always_verified.sql`](../supabase/migrations/20261118030000_records_always_verified.sql) — 임시: 모든 기록을 검증된 것으로 처리

(Supabase CLI 를 프로젝트에 연결해 두었다면 `supabase db push` 로 같은 작업을 할 수 있습니다.)

## 2. Auth 설정

배포 전에 마이그레이션 5(보안 강화)가 반드시 필요합니다. 전체 프로필은 본인만 볼 수 있고, 공개 정보는 `public_profiles` 를 사용합니다. 기록은 미검증 개인 백업이며 계정당 2000개로 제한됩니다. 제한과 배포 세부 사항은 [보안 경계](SECURITY.md) 를 참고하세요.

Supabase Dashboard → **Authentication**:

- **Sign In / Providers → Email**: 활성화, **Confirm email: ON**.
- **Sign In / Providers → Email → Minimum password length**: 8 (가입 양식에서 영문 + 숫자도 요구합니다).
- **URL Configuration**
  - **Site URL**: 배포된 게임 URL (예: `https://you.github.io/AvoidNSurviveMaker/`)
  - **Redirect URLs**: 같은 URL 과 로컬 테스트용 `http://localhost:5173/` 을 추가합니다.
    인증 메일은 플레이어를 가입한 페이지로 돌려보냅니다.
- **Emails → SMTP**: 기본 메일 발송기는 시간당 몇 통으로 제한되어 테스트용입니다. 실제 플레이어가 가입하기 전에 별도 SMTP 제공자를 설정하세요.

### 메일 전달률 (스팸함 피하기)

- **템플릿**: Authentication → Emails → Templates → *Confirm signup*. 제목은
  `Confirm your Avoid N Survive account`, 본문은
  [`supabase/templates/confirm-signup.html`](../supabase/templates/confirm-signup.html) 을 사용합니다.
- **보낸 사람 이름**: 메일 내용과 맞도록 게임 이름(`Avoid N Survive`)을 사용합니다.
- **보낸 사람 주소**: 개인 Gmail 계정은 테스트에는 쓸 수 있지만 스팸으로 분류되기 쉽습니다.
  실제 서비스에서는 트랜잭션 메일 서비스(Resend, Brevo, Amazon SES 등)를 **자체 도메인**과 함께 쓰고, 제공자 안내에 따라 SPF, DKIM, DMARC DNS 레코드를 설정하세요.

## 3. CAPTCHA (Cloudflare Turnstile)

1. Cloudflare Dashboard → **Turnstile** → **Add widget**. 도메인(과 `localhost`)을 추가합니다.
   **site key**(공개)와 **secret key** 를 받습니다.
2. Supabase Dashboard → **Authentication → Attack Protection** → **CAPTCHA protection** 활성화,
   제공자 **Turnstile**, **secret key** 를 붙여 넣습니다.
3. **site key** 를 `.env.local` 에 넣습니다(아래 참고).

CAPTCHA 보호가 켜져 있으면 Supabase 는 가입, 로그인, 인증 메일 재발송에 토큰을 요구합니다. 게임은 세 화면 모두에 위젯을 표시합니다.

로컬 테스트에는 Cloudflare 의 항상 통과하는 테스트 키를 쓸 수 있습니다:
site key `1x00000000000000000000AA`, secret key `1x0000000000000000000000000000000AA`.
테스트 secret 을 운영 환경에 남겨 두지 마세요.

## 4. 게임 연결

`.env.example` 을 `.env.local`(git 에서 무시됨)로 복사하고 값을 채웁니다.

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable / anon key>   # Project Settings → API
VITE_TURNSTILE_SITE_KEY=<turnstile site key>
```

publishable(anon) 키는 공개되어도 되는 키이며, 데이터는 row level security 가 보호합니다.
`service_role` / secret 키는 **절대** 게임에 넣지 마세요.

`.env.local` 을 바꾼 뒤에는 `run-dev.bat`(또는 `npm run dev`)을 다시 시작합니다.

## 플레이 시간

플레이어가 로그인해 있고 게임 탭이 보이는 동안(메뉴, 에디터, 플레이 모두) 시간이 누적됩니다. 탭이 숨겨지거나 최소화되면 멈추므로, 잊고 둔 백그라운드 탭 때문에 시간이 쌓이지 않습니다. 게임은 30초마다, 그리고 탭이 숨겨지거나 닫힐 때 센 정수 초를 `add_play_time(seconds)` 로 보냅니다(1초 미만 나머지는 이월). 보내지 못한 시간은 브라우저에 남겨 두었다가 다음 방문 때 보냅니다. 메뉴에서 플레이어 태그 아래에 총 시간이 표시됩니다.

보고는 브라우저에서 오기 때문에 데이터베이스가 제한합니다: 한 번의 보고는 직전 보고 이후 실제로 흐른 시간(+5초)보다, 그리고 한 번에 1시간보다 많이 더할 수 없습니다. 덕분에 탭을 여러 개 열어도 같은 시간이 두 번 계산되지 않습니다.

## 레벨 기록

로그인한 플레이어가 챕터 레벨을 클리어하면 최고 시간(정수 ms)과 별을 `submit_level_records(records)` 로 보냅니다. 보내지 못한 기록은 계정별로 브라우저에 남겨 두고 다음 클리어나 로그인 때 다시 시도합니다. 서버는 병합하므로 기록은 좋아지기만 합니다: `best_ms` 는 가장 낮은 값을, `stars` 는 가장 높은 값을 유지합니다.

로그인 전(또는 이 기능이 생기기 전)에 세운 기록은 플레이어가 **Options → Level records → Sync records** 를 누를 때까지 브라우저에 남습니다. 이 버튼은 이 브라우저의 모든 기록을 올리고 계정의 기록을 내려받으며, 양쪽 모두 각 레벨의 최고 기록을 유지합니다.

**Main menu → Stats** 는 프로필과 모든 `level_records` 행을 데이터베이스에서 직접 읽습니다.

## 사망 횟수

사망은 미로가 도전을 끝낸 경우입니다(벽, 움직이는 벽, 허공, 맵 경계, 레이저). 브라우저가 중단시킨 도전(커서가 창을 벗어남, 탭 포커스 상실, 마우스가 아닌 포인터)과 에디터 테스트 플레이는 세지 않습니다. 모든 사망은 `profiles.total_deaths` 에 더해지고, 챕터와 커스텀 팩 레벨에서의 사망은 해당 레벨의 `level_deaths` 행(레벨 기록과 같은 `level_key`)에도 더해집니다. 공유 맵과 팩은 전체 횟수에만 반영됩니다.

사망 횟수는 계정별로 브라우저에서 센 뒤, 사망 몇 초 후, 탭이 숨겨질 때, 로그아웃 직전에 `add_deaths(total, levels)` 로 보냅니다. 보내지 못한 횟수는 localStorage 에 남겨 두었다가 다음 방문 때 보냅니다. 서버는 더하기만 합니다(호출당 최대 10 000회, 200개 레벨, 플레이어당 레벨 행 2000개). 로그아웃 상태의 사망은 기록되지 않습니다. **Stats** 에 전체 횟수와 가장 많이 죽은 레벨이 표시됩니다.

## 순위표

레벨 선택 화면에는 사이드 패널이 있습니다: 챕터 정보(번호, 이름, 별, 난이도, 설명)와, 마우스를 올린 레벨의 순위표를 `level_leaderboard(key, limit)` 로 읽어 보여 줍니다 — 상위 10명과 플레이어 본인의 순위. 로그인 여부와 관계없이 누구나 읽을 수 있으며, 공개 태그, 시간, 별만 반환합니다.

**검증된** 기록만 순위에 오릅니다. 현재는 마이그레이션 8 이 모든 기록을 검증된 것으로 표시하므로 모든 클리어가 순위에 오릅니다 — 브라우저에서 위조한 제출도 포함됩니다([보안 경계](SECURITY.md) 참고). 신뢰할 수 있는 리플레이 검증기가 생기면 새 제출은 다시 미검증으로 저장해야 합니다. 커스텀 팩 레벨은 팩 id 가 유일하지 않으므로 순위표가 없습니다.

## 흐름

1. **Create Account**: 이메일, 비밀번호(+ 확인), 닉네임, CAPTCHA. 제출 전에 양식이 규칙을 확인하고, 해당 닉네임에 남은 태그 수를 서버에 묻습니다.
2. 데이터베이스가 계정과 같은 트랜잭션에서 무작위 태그로 프로필을 만듭니다.
3. **Check your email** 화면: 플레이어가 메일의 링크를 클릭합니다(60초 후 재발송 가능).
4. 링크를 따라 게임으로 돌아오면 로그인되고 `Nickname#1234` 로 인사합니다.
   다른 브라우저에서 링크를 열어도 이메일은 인증되며, 플레이어는 평소처럼 로그인하면 됩니다.
5. 인증 전에 **Sign In** 하면 "Please verify your email first" 와 재발송 버튼이 표시됩니다.
