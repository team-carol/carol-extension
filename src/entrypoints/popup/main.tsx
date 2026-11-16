import { render } from 'preact'
import { App } from './App'
// team carol 디자인 시스템 토큰(--crl-*). 팝업은 확장 페이지라 :root 에 걸어도 됨.
import '@team-carol/design-system/tokens.css'
import './style.css'

render(<App />, document.getElementById('app')!)
