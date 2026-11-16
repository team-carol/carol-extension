/**
 * team carol 디자인 시스템(@team-carol/design-system) 토큰을 maimai NET 주입 UI에 붙임.
 *
 * 토큰을 `:root`에 걸면 원본 사이트 CSS와 섞이므로, `.mmp-crl` 클래스가 붙은 요소(우리가 만든
 * 루트 엘리먼트)에만 `--crl-*` CSS 변수를 스코프로 선언한다. 주입 CSS는 `var(--crl-*)`만 쓰고
 * 색을 직접 박지 않는다. 토큰이 맞지 않으면 디자인 시스템 저장소에서 고칠 것.
 *
 * 웹 폰트(Pretendard·JetBrains Mono)는 원격 로드하지 않음 — 폰트 스택의 시스템 폰트로 대체됨.
 */
import { toCssVars } from '@team-carol/design-system'

/** 주입 UI 루트에 붙이는 클래스. 이 아래에서만 `var(--crl-*)`가 풀림. */
export const CRL_SCOPE = 'mmp-crl'

const TOKENS_STYLE_ID = 'mmp-crl-tokens'

/** 토큰 스타일을 한 번만 주입. 여러 기능이 같이 써서 destroy에서 지우지 않음. */
export function injectTokens(): void {
  if (document.getElementById(TOKENS_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = TOKENS_STYLE_ID
  style.textContent = toCssVars(`.${CRL_SCOPE}`)
  ;(document.head ?? document.documentElement).appendChild(style)
}
