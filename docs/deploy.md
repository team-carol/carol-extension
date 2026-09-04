# 배포

Chrome Web Store 업로드는 GitHub Actions(`.github/workflows/deploy.yml`)가 한다.
빌드 도구는 WXT의 `wxt submit`(= `publish-browser-extension`).

## 한 번만 하는 준비

### 1. 웹스토어에 확장을 최초 1회 수동 등록

API로는 **업데이트만** 된다. 첫 등록은 개발자 대시보드에서 직접 zip을 올려야
`CHROME_EXTENSION_ID`가 생긴다.

```bash
pnpm zip          # .output/maimaidxtension-<version>-chrome.zip
```

### 2. Google Cloud에서 OAuth 자격증명 발급

1. Google Cloud Console → 새 프로젝트
2. **Chrome Web Store API** 사용 설정
3. OAuth 동의 화면 구성 (External, 테스트 사용자에 본인 계정 추가)
4. 사용자 인증 정보 → OAuth 클라이언트 ID → **Desktop app**
   → `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`
5. refresh token 발급 (스코프 `https://www.googleapis.com/auth/chromewebstore`):

   ```bash
   npx @plasmohq/chrome-webstore-api generate-refresh-token
   # 또는 wxt 문서의 안내(https://wxt.dev/guide/essentials/publishing.html) 참고
   ```

   → `CHROME_REFRESH_TOKEN`

### 3. 리포지토리 시크릿 등록

Settings → Secrets and variables → Actions → New repository secret:

| 이름 | 값 |
|---|---|
| `CHROME_EXTENSION_ID` | 웹스토어 확장 ID |
| `CHROME_CLIENT_ID` | OAuth 클라이언트 ID |
| `CHROME_CLIENT_SECRET` | OAuth 클라이언트 시크릿 |
| `CHROME_REFRESH_TOKEN` | 위에서 받은 refresh token |

## 배포 절차

1. `package.json`의 `version`을 올린다 (웹스토어는 같은 버전 재업로드 불가).
   `wxt.config.ts`에 별도 버전이 없으므로 매니페스트 버전은 여기서 나온다.
2. 커밋하고 같은 버전으로 태그를 단다.

   ```bash
   git commit -am "chore: v0.1.0"
   git tag v0.1.0
   git push origin main --tags
   ```

3. `v*` 태그 push가 워크플로를 트리거한다:
   사전 검사 → 타입 검사 → 태그·버전 일치 확인 → `pnpm zip` → `wxt submit` → GitHub 릴리스.

태그와 `package.json` 버전이 다르면 잡이 실패한다.

## 수동 실행

Actions 탭 → **Deploy to Chrome Web Store** → Run workflow.

- `dry_run` (기본 켜짐): 빌드·검증만. 웹스토어 업로드 안 함. zip은 아티팩트로 확인 가능.
- `skip_review`: 업로드는 하되 심사 제출은 보류(웹스토어 draft). 대시보드에서 수동 제출.

## 로컬에서 제출

```bash
cp .env.submit.example .env.submit   # 값 채우기
pnpm zip
pnpm submit                 # 실제 제출
pnpm submit --dry-run       # 제출 직전까지만
pnpm submit --skip-review   # draft로만 업로드
```

`.env.submit`은 커밋하지 말 것 (`.gitignore`에 있음).
