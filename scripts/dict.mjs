#!/usr/bin/env node
/**
 * ko.json 정렬 + 검증.
 *   pnpm dict         검사만 (문제 있으면 exit 1)
 *   pnpm dict --write 정렬해서 저장
 *
 * 정렬은 코드포인트 순. localeCompare는 환경에 따라 순서가 달라져 diff가 흔들림.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = new URL('../src/i18n/ko.json', import.meta.url)
const write = process.argv.includes('--write')

// core/normalize.ts의 normalize()와 같은 규칙. 저쪽을 고치면 여기도 맞출 것.
const normalize = (s) =>
  s.replace(/　/g, ' ').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()

const raw = readFileSync(FILE, 'utf8')
let dict
try {
  dict = JSON.parse(raw)
} catch (e) {
  console.error(`✗ ko.json 파싱 실패: ${e.message}`)
  process.exit(1)
}

const keys = Object.keys(dict)
const problems = []
const notes = []

// 정규화하면 같아지는 키 — 눈에는 달라 보여도 하나만 살아남음
const byNorm = new Map()
for (const k of keys) {
  const n = normalize(k)
  if (!byNorm.has(n)) byNorm.set(n, [])
  byNorm.get(n).push(k)
}
for (const [n, group] of byNorm) {
  if (group.length > 1) {
    problems.push(`키 충돌 (정규화하면 "${n}"): ${group.map((g) => JSON.stringify(g)).join(', ')}`)
  }
}

// 앞뒤/연속 공백이 낀 키 — 동작은 하지만 파일이 지저분해짐
const dirty = keys.filter((k) => k !== normalize(k))
if (dirty.length) {
  notes.push(`공백 정리 필요 ${dirty.length}개: ${dirty.slice(0, 5).map((k) => JSON.stringify(k)).join(', ')}${dirty.length > 5 ? ' …' : ''}`)
}

// 패턴 키 검사 — 값에 있는 {n}이 키에 없으면 옮겨 담을 게 없어 런타임에서 무시됨
const ph = (s) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1])
let patternCount = 0
for (const k of keys) {
  const inKey = ph(k)
  if (!inKey.length) continue
  patternCount++
  const v = dict[k]
  if (typeof v !== 'string' || !v) continue
  const missing = ph(v).filter((n) => !inKey.includes(n))
  if (missing.length) {
    problems.push(`패턴 불일치 ${JSON.stringify(k)}: 값의 {${missing.join('}, {')}} 가 키에 없음`)
  }
  if (!ph(v).length) {
    notes.push(`패턴 ${JSON.stringify(k)}: 값에 자리표시자가 없어 유동 부분이 사라짐`)
  }
}

// glossary의 "번역하지 않는 것" — 막지는 않고 알려만 줌
const keepAsIs = new Set(
  JSON.parse(readFileSync(new URL('../src/i18n/keep-as-is.json', import.meta.url), 'utf8'))
    .map((s) => s.toLowerCase()),
)
const shouldKeep = keys.filter((k) => keepAsIs.has(normalize(k).toLowerCase()))
if (shouldKeep.length) {
  notes.push(
    `glossary상 번역하지 않는 표기 ${shouldKeep.length}개가 들어 있음: ` +
      shouldKeep.map((k) => JSON.stringify(k)).join(', ') +
      ' (의도한 것이면 그대로 두면 됨)',
  )
}

// 값 검사
const empty = keys.filter((k) => !dict[k])
const nonString = keys.filter((k) => typeof dict[k] !== 'string')
if (nonString.length) {
  problems.push(`값이 문자열이 아님: ${nonString.slice(0, 5).map((k) => JSON.stringify(k)).join(', ')}`)
}

for (const p of problems) console.error(`✗ ${p}`)
for (const n of notes) console.warn(`! ${n}`)

console.log(`  항목 ${keys.length}개 (번역됨 ${keys.length - empty.length}, 빈 값 ${empty.length}, 패턴 ${patternCount})`)

if (problems.length) process.exit(1)

if (write) {
  const out = {}
  for (const k of keys.map(normalize).sort()) out[k] = dict[keys.find((x) => normalize(x) === k)]
  writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n', 'utf8')
  console.log('✓ 정렬해서 저장함')
} else if (dirty.length) {
  console.log('  → `pnpm dict --write` 로 정리 가능')
}
