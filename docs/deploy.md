# 배포

`main` 푸시와 PR에서는 `.github/workflows/ci.yml`이 사전·타입 검사와 ZIP 빌드를 한다.
`v*` 태그 푸시에서는 `.github/workflows/deploy.yml`이 같은 검사를 거쳐
Chrome Web Store API v2로 확장 ZIP을 업로드하고 심사를 제출한 뒤 GitHub 릴리스를 만든다.
수동 실행도 가능하다. 제출 도구는 `publish-browser-extension`이다.

## 한 번만 하는 준비

### 1. 웹스토어 항목 등록

처음에는 [Chrome Web Store 개발자 대시보드](https://chrome.google.com/webstore/devconsole)에서
확장을 등록하고 스토어 리스팅과 개인정보 보호 항목을 채운다.
개인정보처리방침 URL은 `https://maimai.team-carol.com/privacy`를 사용한다.
`pnpm zip`으로 만든 `.output/maimaidxtension-<version>-chrome.zip`을 사용한다.
항목 URL의 확장 ID와 게시자 설정의 Publisher ID를 기록한다.

### 2. API v2 서비스 계정 연결

1. Google Cloud 프로젝트에서 **Chrome Web Store API**를 사용 설정한다.
2. 서비스 계정을 만들고 JSON 키를 발급한다.
3. 웹스토어 개발자 대시보드 **Account**에서 서비스 계정 이메일을 추가한다.
4. JSON 키의 `client_email`과 `private_key`를 확인한다.

서비스 계정 설정은 [Chrome 공식 안내](https://developer.chrome.com/docs/webstore/service-accounts)를 따른다.
키 파일은 저장소에 넣지 않는다.

### 3. GitHub Actions 시크릿 등록

저장소 Settings → Secrets and variables → Actions에 다음 시크릿을 등록한다.

| 이름 | 값 |
|---|---|
| `CHROME_EXTENSION_ID` | 웹스토어 확장 ID |
| `CHROME_PUBLISHER_ID` | 웹스토어 Publisher ID |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | 서비스 계정 JSON의 `client_email` |
| `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | 서비스 계정 JSON의 `private_key` 전체 (줄바꿈 포함) |

## 검증 및 배포

1. Actions → **Deploy to Chrome Web Store** → Run workflow에서 `dry_run`을 켠 채 실행한다.
   인증과 빌드를 검사하되 업로드하지 않는다.
2. `package.json`의 `version`을 올리고 커밋한다. 웹스토어는 같은 버전의 ZIP을 다시 받지 않는다.
3. 같은 버전의 태그를 푸시한다.

   ```bash
   git tag v0.1.0
   git push origin main v0.1.0
   ```

태그 버전과 `package.json` 버전이 다르면 배포가 중단된다.
태그 배포는 ZIP 업로드와 심사 제출까지 수행한다. 심사 승인 후 스토어에 게시된다.
수동 실행에서 `dry_run`을 끄면 실제 제출하고, `skip_review`를 켜면 업로드만 한다.

## 로컬 제출

```bash
cp .env.submit.example .env.submit
pnpm zip
pnpm submit --dry-run
pnpm submit
pnpm submit --skip-review
```

`.env.submit`에 서비스 계정 정보를 채운다. 이 파일은 `.gitignore`에 포함돼 있다.
