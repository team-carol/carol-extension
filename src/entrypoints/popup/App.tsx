import { useCallback, useEffect, useState } from 'preact/hooks'
import {
  SETTING_OPTION_PRESET,
  SETTING_SONG_SEARCH,
  SETTING_SONG_TITLES,
  SETTING_UI_TRANSLATE,
  carolToken,
  parseCarolToken,
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

      <PresetSection />
    </div>
  )
}

/**
 * carol 게임 옵션 프리셋. carol 서버와 통신(프리셋 저장·조회, 옵션 스냅샷)하므로
 * 기본 OFF, 토큰 등록이 필요해 별도 섹션으로 둔다.
 */
function PresetSection() {
  const [on, setOn] = useState(false)
  const [ready, setReady] = useState(false)
  const [token, setToken] = useState('')
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void Promise.all([settings.get(SETTING_OPTION_PRESET, false), carolToken.get()]).then(
      ([v, tok]) => {
        setOn(v)
        setToken(tok)
        setReady(true)
      },
    )
  }, [])

  const toggle = useCallback((next: boolean) => {
    setOn(next)
    void settings.set(SETTING_OPTION_PRESET, next)
  }, [])

  const save = useCallback(() => {
    const parsed = parseCarolToken(draft)
    setToken(parsed)
    setDraft('')
    setSaved(true)
    void carolToken.set(parsed)
    setTimeout(() => setSaved(false), 2000)
  }, [draft])

  const clear = useCallback(() => {
    setToken('')
    void carolToken.set('')
  }, [])

  return (
    <section class="mmp-preset">
      <label class="mmp-label">
        <span class="mmp-text">
          <span class="mmp-name">게임 옵션 프리셋</span>
          <span class="mmp-hint">캐롤봇에 옵션을 저장하고 한 번에 적용</span>
        </span>
        <Switch checked={on} disabled={!ready} onChange={toggle} />
      </label>

      {on && (
        <div class="mmp-preset-body">
          <p class="mmp-preset-note">
            게임 옵션 값과 옵션 페이지 HTML이 carol 서버(maimai.team-carol.com)로
            전송됩니다. SEGA 로그인 비밀번호는 보내지 않습니다. 토큰은 이 기기에만
            저장됩니다.
          </p>

          {token ? (
            <div class="mmp-preset-tok">
              <span class="crl-tag crl-tag--success">토큰 등록됨 · ••••{token.slice(-4)}</span>
              <span class="mmp-spacer" />
              <button
                type="button"
                class="crl-btn crl-btn--sm crl-btn--secondary mmp-btn-danger"
                onClick={clear}
              >
                삭제
              </button>
            </div>
          ) : (
            <p class="mmp-preset-hint">
              디스코드 <code>/북마클릿</code>으로 받은 링크(또는 북마클릿 주소)를 붙여넣기
            </p>
          )}

          <div class="mmp-preset-in">
            <input
              type="text"
              class="crl-input"
              aria-label="carol 토큰 또는 링크"
              placeholder="https://maimai.team-carol.com/sync?code=…"
              value={draft}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) save()
              }}
            />
            <button
              type="button"
              class="crl-btn crl-btn--sm crl-btn--primary"
              disabled={!draft.trim()}
              onClick={save}
            >
              {saved ? '저장됨' : '저장'}
            </button>
          </div>
        </div>
      )}
    </section>
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
        <Switch checked={on} disabled={!ready} onChange={change} />
      </label>
    </li>
  )
}

function Switch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <span class="mmp-switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
      <span class="mmp-track" aria-hidden="true" />
    </span>
  )
}
