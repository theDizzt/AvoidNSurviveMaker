# 배포 설정 및 오류 해결

`main`에 push하면 GitHub Pages와 Vercel 워크플로가 실행됩니다. 정기 실행(schedule)은 설정되어 있지 않습니다.

## GitHub Pages

저장소 Settings > Pages > Build and deployment에서 Source를 GitHub Actions로 설정합니다.
워크플로는 Node.js 24에서 `npm ci`, `npm test`, `npm run build` 순서로 실행합니다.
Supabase 및 Turnstile 공개 설정은 Actions의 Repository variables에 등록합니다.

## Vercel

저장소 Settings > Secrets and variables > Actions > Repository secrets에 다음 세 값을 등록합니다.

- `VERCEL_TOKEN`: 대상 프로젝트에 접근할 수 있는 Vercel 계정에서 발급한 토큰.
- `VERCEL_ORG_ID`: 대상 프로젝트를 `vercel link`로 연결한 후 `.vercel/project.json`의 `orgId`.
- `VERCEL_PROJECT_ID`: 같은 파일의 `projectId`.

토큰은 소스 코드에 넣지 않습니다. `.vercel/project.json`도 커밋하지 않습니다.
Vercel 프로젝트의 Node.js 버전은 24.x로 맞추고, Production 환경에 필요한 `VITE_*` 환경 변수를 등록합니다.
`VITE_SUPABASE_URL`에는 Supabase 프로젝트 URL(`https://<project-ref>.supabase.co`),
`VITE_SUPABASE_PUBLISHABLE_KEY`에는 해당 프로젝트의 공개 키를 입력합니다.
`vercel env add ...` 같은 명령문을 변수 값에 입력하지 않습니다.
GitHub Actions Variables와 Vercel의 Environment Variables는 별도 설정입니다.
이 워크플로는 `vercel pull`로 Vercel의 Production 값을 받아 빌드합니다.
`VITE_*` 값은 빌드 시 포함되므로 값을 수정한 후 반드시 새로 빌드하고 배포해야 합니다.
잘못된 계정 설정은 오프라인 플레이로 대체되지만 로그인 및 온라인 기록 기능에는 올바른 설정이 필요합니다.
워크플로는 Vercel CLI 66.0.0을 사용하며, 버전 변경은 명시적으로 진행합니다.

필수 secret이 빠진 push에서는 설정 확인 작업에 경고와 요약을 남기고 실제 배포 작업은 건너뜁니다.
이는 배포 성공을 의미하지 않습니다. 수동 Run workflow에서는 설정이 빠지면 실패로 표시합니다.
세 값을 등록한 뒤 Actions > Deploy to Vercel > Run workflow로 배포할 수 있습니다.
토큰이 만료되거나 접근 권한이 없으면 실제 배포는 계속 실패하므로 토큰과 프로젝트 권한을 갱신해야 합니다.

## 의존성 잠금 파일

`npm ci`는 `package.json`과 `package-lock.json`이 일치해야 실행됩니다.
이번 수정은 누락된 `@emnapi/core@2.0.0-beta.2`와 `@emnapi/runtime@2.0.0-beta.2` 정보를 npm 레지스트리의 배포 URL 및 무결성 값으로 복구합니다.
Vercel도 `npm ci`를 사용해 같은 잠금 파일로 설치합니다.

의존성 변경 시 Node.js 24 환경에서 `npm install`을 실행하고 두 파일을 함께 커밋합니다.
잠금 파일만 갱신할 때는 `npm install --package-lock-only --ignore-scripts`를 사용할 수 있습니다.
패키지 항목을 수동으로 삭제하지 않습니다.

수정 후 사용자가 확인할 명령은 `npm ci`, `npm test`, `npm run build`입니다.
이번 수정 과정에서는 테스트, 빌드 및 배포를 실행하지 않았습니다.
