/**
 * 곡 별명 데이터 공급자.
 *
 * maimai NET은 서버 렌더 다중 페이지라 페이지를 넘길 때마다 콘텐츠 스크립트가
 * 새로 뜸. 거기서 직접 API를 부르면 이동할 때마다 요청이 나감 → 백그라운드에
 * 한 번만 받아 캐시하고, 콘텐츠 스크립트는 메시지로 받아감.
 *
 * 전체 목록 하나만 받아서 번역(isTranslation=true)과 검색용 별명을 둘 다 파생함.
 * `?translation=1`을 따로 부르면 같은 데이터를 두 번 받게 됨.
 *
 * 캐시가 있으면 만료됐더라도 일단 그것부터 돌려줌(네트워크 때문에 페이지가
 * 늦어지면 안 됨). API가 죽어도 곡명이 원제로 보일 뿐 나머지는 정상 동작.
 */
import { storage } from '@/core/storage'
import {
  GET_SONG_ALIASES,
  GET_SONG_TRANSLATIONS,
  type AliasMap,
  type SongMap,
} from '@/features/songData'

const API = 'https://maimai.bitworkspace.kr/api/aliases'
const CACHE_KEY = 'songAliases'
const TTL = 24 * 60 * 60 * 1000 // 곡 데이터는 게임 버전 단위로 바뀌는 준정적 데이터

interface AliasRow {
  title: string
  alias: string
  isTranslation: boolean
}

interface Cached {
  at: number
  rows: AliasRow[]
}

async function fetchRows(): Promise<AliasRow[]> {
  const res = await fetch(API)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as { count: number; aliases: AliasRow[] }
  if (!Array.isArray(json.aliases)) throw new Error('예상과 다른 응답 형식')
  return json.aliases.filter((r) => r.title && r.alias)
}

let inflight: Promise<AliasRow[]> | null = null

async function getRows(): Promise<AliasRow[]> {
  const cached = await storage.get<Cached>(CACHE_KEY)
  if (cached && Date.now() - cached.at < TTL) return cached.rows

  inflight ??= fetchRows()
    .then(async (rows) => {
      await storage.set(CACHE_KEY, { at: Date.now(), rows } satisfies Cached)
      return rows
    })
    .finally(() => {
      inflight = null
    })

  if (cached) {
    // 만료본이 있으면 갱신은 백그라운드로 돌리고 즉시 응답
    void inflight.catch(() => {})
    return cached.rows
  }

  try {
    return await inflight
  } catch (err) {
    console.warn('[mmp] 곡 별명 데이터를 못 받아옴', err)
    return []
  }
}

/** 원제 → 한국어 곡명. */
function toTranslations(rows: AliasRow[]): SongMap {
  const map: SongMap = {}
  for (const r of rows) if (r.isTranslation) map[r.title] = r.alias
  return map
}

/** 원제 → 별명 목록 (번역 포함). 검색용. */
function toAliases(rows: AliasRow[]): AliasMap {
  const map: AliasMap = {}
  for (const r of rows) (map[r.title] ??= []).push(r.alias)
  return map
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(async (msg: unknown) => {
    const type = (msg as { type?: string } | null)?.type
    if (type === GET_SONG_TRANSLATIONS) return toTranslations(await getRows())
    if (type === GET_SONG_ALIASES) return toAliases(await getRows())
    return undefined
  })
})
