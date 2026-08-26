import { useCallback, useEffect, useState } from 'preact/hooks'
import {
  SETTING_SONG_SEARCH,
  SETTING_SONG_TITLES,
  SETTING_UI_TRANSLATE,
  settings,
} from '@/core/storage'

interface Item {
  setting: string
  label: string
  hint: string
}

const ITEMS: Item[] = [
  {
    setting: SETTING_UI_TRANSLATE,
    label: 'UI 문구 번역',
    hint: '메뉴·버튼·안내 문구를 한국어로',
  },
  {
    setting: SETTING_SONG_TITLES,
    label: '곡명 한국어 표시',
    hint: '일본어 곡 제목을 한국어로',
  },
  {
    setting: SETTING_SONG_SEARCH,
    label: '곡 목록 검색창',
    hint: '별명·한국어·원제로 곡 찾기',
  },
]

export function App() {
  // 이름은 manifest 한 곳에서만 관리 (wxt.config.ts)
  const name = browser.runtime.getManifest().name

  return (
    <div class="mmp-popup">
      <header class="mmp-head">
        <img class="mmp-mark" src="/icon/mark.png" alt="" />
        <div class="mmp-title">
          <h1>{name}</h1>
          <p class="mmp-sub">maimaiDX NET을 위한</p>
        </div>
      </header>

      <ul class="mmp-list">
        {ITEMS.map((item) => (
          <Row key={item.setting} item={item} />
        ))}
      </ul>

    </div>
  )
}

function Row({ item }: { item: Item }) {
  const [on, setOn] = useState(true)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void settings.get(item.setting, true).then((v) => {
      setOn(v)
      setReady(true)
    })
  }, [item.setting])

  const change = useCallback(
    (next: boolean) => {
      setOn(next)
      void settings.set(item.setting, next)
    },
    [item.setting],
  )

  return (
    <li class="mmp-item">
      <label class="mmp-label">
        <span class="mmp-text">
          <span class="mmp-name">{item.label}</span>
          <span class="mmp-hint">{item.hint}</span>
        </span>
        <span class="mmp-switch">
          <input
            type="checkbox"
            checked={on}
            disabled={!ready}
            onChange={(e) => change((e.target as HTMLInputElement).checked)}
          />
          <span class="mmp-track" aria-hidden="true" />
        </span>
      </label>
    </li>
  )
}
