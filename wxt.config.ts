import { defineConfig } from 'wxt'
import preact from '@preact/preset-vite'

// https://wxt.dev/api/config.html
// WXT엔 공식 preact 모듈이 없어 Vite 플러그인으로 붙임.
// (@preact/preset-vite가 jsxImportSource=preact 설정 + react→preact/compat alias 처리)
export default defineConfig({
  srcDir: 'src',
  vite: () => ({
    plugins: [preact()],
  }),
  manifest: {
    name: '캐롤익스텐션',
    // host는 와일드카드 금지 — 대상 두 리전만 명시 (웹스토어 심사 대비)
    permissions: ['storage'],
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      96: '/icon/96.png',
      128: '/icon/128.png',
    },
    host_permissions: [
      'https://maimaidx.jp/maimai-mobile/*',
      'https://maimaidx-eng.com/maimai-mobile/*',
      // 곡명 번역 데이터 조회 (읽기 전용, 사용자 정보 안 보냄)
      'https://maimai.bitworkspace.kr/*',
    ],
  },
})
