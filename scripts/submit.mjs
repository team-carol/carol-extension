#!/usr/bin/env node
/**
 * 로컬에서 Chrome Web Store로 수동 제출.
 *   pnpm zip && pnpm submit
 *
 * 자격증명은 프로젝트 루트의 .env.submit 에서 읽는다 (wxt submit이 자동 로드).
 *   CHROME_EXTENSION_ID=...
 *   CHROME_CLIENT_ID=...
 *   CHROME_CLIENT_SECRET=...
 *   CHROME_REFRESH_TOKEN=...
 * .env.submit 은 .gitignore 에 있음. 커밋 금지.
 *
 * 옵션:
 *   --dry-run        제출 직전까지만. 실제 업로드 안 함
 *   --skip-review    업로드만 하고 심사 제출은 보류 (웹스토어 draft)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const zip = `.output/${pkg.name}-${pkg.version}-chrome.zip`

if (!existsSync(zip)) {
  console.error(`✗ ${zip} 없음. 먼저 \`pnpm zip\` 실행.`)
  process.exit(1)
}

const args = ['wxt', 'submit', '--chrome-zip', zip]
if (process.argv.includes('--dry-run')) args.push('--dry-run')
if (process.argv.includes('--skip-review')) process.env.CHROME_SKIP_SUBMIT_REVIEW = 'true'

const r = spawnSync('pnpm', ['exec', ...args], { stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(r.status ?? 1)
