// Юнит-тесты чистой логики (Node с поддержкой TypeScript type stripping, ≥ 22.18).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRanges, pagesToRanges, clampRanges } from '../src/shared/ranges.ts'
import { estimateCompressed, formatBytes, savingsPercent } from '../src/shared/estimate.ts'

test('parseRanges: обычные диапазоны', () => {
  assert.deepEqual(parseRanges('1-5, 8, 12-20').ranges, [
    { from: 1, to: 5 },
    { from: 8, to: 8 },
    { from: 12, to: 20 }
  ])
})

test('parseRanges: открытые диапазоны и ограничение числом страниц', () => {
  assert.deepEqual(parseRanges('10-', 15).ranges, [{ from: 10, to: 15 }])
  assert.deepEqual(parseRanges('-3', 15).ranges, [{ from: 1, to: 3 }])
  assert.deepEqual(parseRanges('3 – 7').ranges, [{ from: 3, to: 7 }])
})

test('parseRanges: ошибки', () => {
  assert.ok(parseRanges('').error)
  assert.ok(parseRanges('5-2').error)
  assert.ok(parseRanges('abc').error)
  assert.ok(parseRanges('0').error)
  assert.ok(parseRanges('30', 10).error)
})

test('pagesToRanges и clampRanges', () => {
  assert.deepEqual(pagesToRanges([7, 1, 2, 3, 3]), [
    { from: 1, to: 3 },
    { from: 7, to: 7 }
  ])
  assert.deepEqual(clampRanges([{ from: 1, to: 50 }, { from: 60, to: 70 }], 40), [{ from: 1, to: 40 }])
})

test('прогноз: сильнее пресет — меньше файл, не больше исходного', () => {
  const stats = {
    fileSize: 10_000_000,
    imageBytes: 9_000_000,
    images: [{ w: 2480, h: 3508, bpc: 8, comps: 3, filter: 'DCT', bytes: 9_000_000, count: 6 }],
    pageHint: 6,
    encrypted: false
  }
  const l = estimateCompressed(stats, 'light')
  const m = estimateCompressed(stats, 'medium')
  const u = estimateCompressed(stats, 'ultra')
  assert.ok(l <= stats.fileSize && m < l && u < m, `${l} ${m} ${u}`)
  const textOnly = { fileSize: 50_000, imageBytes: 0, images: [], pageHint: 3, encrypted: false }
  assert.ok(estimateCompressed(textOnly, 'medium') <= 50_000)
})

test('formatBytes / savingsPercent', () => {
  assert.equal(formatBytes(42.5 * 1024 * 1024), '42.5 МБ')
  assert.equal(savingsPercent(100, 28), 72)
  assert.equal(savingsPercent(100, 120), 0)
})
