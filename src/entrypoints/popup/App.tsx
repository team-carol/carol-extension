import { useCallback, useEffect, useState } from 'preact/hooks'
import {
  type CarolMode,
  SETTING_CAROL_SYNC,
  SETTING_SONG_SEARCH,
  SETTING_SONG_TITLES,
  SETTING_UI_TRANSLATE,
  carolToken,
  parseCarolToken,
  settings,
  toCarolMode,
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

      <CarolSection />
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

const CAROL_MODES: Array<{ value: CarolMode; label: string; hint: string }> = [
  { value: 'off', label: '끄기', hint: '' },
  { value: 'manual', label: '수동', hint: '화면의 버튼을 눌렀을 때만 동기화' },
  {
    value: 'auto',
    label: '자동',
    hint: '홈 진입 시 플레이 카운트가 바뀌었으면 자동 동기화 (+ 버튼)',
  },
]

/**
 * carol 프로필 동기화. 켜면 maimai NET 페이지에 동기화 버튼이 뜨고,
 * 누르면 프로필·기록 HTML이 carol 서버로 전송된다 — 다른 기능과 달리 외부 전송이라
 * 기본 OFF, 별도 섹션으로 분리하고 안내 문구를 붙인다.
 */
function CarolSection() {
  const [mode, setMode] = useState<CarolMode>('off')
  const [ready, setReady] = useState(false)
  const [token, setToken] = useState('')
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void Promise.all([
      settings.get<unknown>(SETTING_CAROL_SYNC, 'off'),
      carolToken.get(),
    ]).then(([raw, tok]) => {
      setMode(toCarolMode(raw))
      setToken(tok)
      setReady(true)
    })
  }, [])

  const pick = useCallback((next: CarolMode) => {
    setMode(next)
    void settings.set(SETTING_CAROL_SYNC, next)
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

  const on = mode !== 'off'
  const hint = CAROL_MODES.find((m) => m.value === mode)?.hint ?? ''

  return (
    <section class="mmp-carol">
      <div class="mmp-carol-hd">
        <span class="mmp-name">carol 프로필 동기화</span>
        <div class="mmp-seg" role="group" aria-label="carol 동기화 모드">
          {CAROL_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              class={'mmp-seg-btn' + (mode === m.value ? ' mmp-on' : '')}
              disabled={!ready}
              aria-pressed={mode === m.value}
              onClick={() => pick(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {hint && <p class="mmp-carol-modehint">{hint}</p>}

      {on && (
        <div class="mmp-carol-body">
          <p class="mmp-carol-note">
            프로필·플레이 기록 HTML이 carol 서버(maimai.bitworkspace.kr)로
            전송됩니다. SEGA 계정 정보는 보내지 않습니다. 토큰은 이 기기에만
            저장되며 브라우저 동기화에 올라가지 않습니다.
          </p>

          {token ? (
            <div class="mmp-carol-tok">
              <span class="mmp-carol-mask">토큰 등록됨 · ••••{token.slice(-4)}</span>
              <button type="button" class="mmp-carol-btn2" onClick={clear}>
                삭제
              </button>
            </div>
          ) : (
            <p class="mmp-carol-hint2">
              디스코드에서 <code>/북마클릿</code> 실행 → 받은 링크를 아래에 붙여넣기
            </p>
          )}

          <div class="mmp-carol-in">
            <input
              type="text"
              placeholder="https://maimai.bitworkspace.kr/sync?code=…"
              value={draft}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.trim()) save()
              }}
            />
            <button
              type="button"
              class="mmp-carol-btn2 mmp-primary"
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
