import { render } from 'preact'
import { App } from './App'
// team carol 디자인 시스템 토큰(--crl-*, :root) + 컴포넌트(crl-btn·crl-input·crl-tag …).
// 팝업은 확장 페이지라 전역으로 넣어도 됨. carol 웹과 같은 버튼·입력창을 그대로 씀.
import '@team-carol/design-system/components.css'
import './style.css'

render(<App />, document.getElementById('app')!)
