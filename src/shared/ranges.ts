// Разбор строки диапазонов страниц: "1-5, 8, 12-20", "10-" (до конца), "-3" (с начала).

export interface PageRange {
  from: number
  to: number
}

export interface ParsedRanges {
  ranges: PageRange[]
  error?: string
}

export function parseRanges(input: string, pageCount?: number | null): ParsedRanges {
  const text = input.trim()
  if (!text) return { ranges: [], error: 'Введите диапазоны страниц, например: 1-5, 8, 12-20' }
  const ranges: PageRange[] = []
  for (const raw of text.split(/[,;]+/)) {
    const part = raw.trim().replace(/[–—]/g, '-')
    if (!part) continue
    const m = /^(\d*)\s*(-)?\s*(\d*)$/.exec(part)
    if (!m || (!m[1] && !m[3])) return { ranges: [], error: `Не удалось разобрать «${part}»` }
    const last = pageCount ?? Number.MAX_SAFE_INTEGER
    const from = m[1] ? Number(m[1]) : 1
    const to = m[2] ? (m[3] ? Number(m[3]) : last) : from
    if (from < 1 || to < 1) return { ranges: [], error: 'Нумерация страниц начинается с 1' }
    if (from > to) return { ranges: [], error: `Диапазон «${part}»: начало больше конца` }
    if (pageCount && from > pageCount)
      return { ranges: [], error: `Страница ${from} вне документа (всего ${pageCount})` }
    ranges.push({ from, to: pageCount ? Math.min(to, pageCount) : to })
  }
  if (!ranges.length) return { ranges: [], error: 'Не указано ни одной страницы' }
  return { ranges }
}

/** Ограничивает диапазоны числом страниц конкретного файла, отбрасывая вышедшие за пределы. */
export function clampRanges(ranges: PageRange[], pageCount: number): PageRange[] {
  return ranges
    .filter((r) => r.from <= pageCount)
    .map((r) => ({ from: r.from, to: Math.min(r.to, pageCount) }))
}

export function rangeLabel(r: PageRange): string {
  return r.from === r.to ? String(r.from) : `${r.from}-${r.to}`
}

/** Сжимает список отдельных страниц в диапазоны: [1,2,3,7] → 1-3, 7 */
export function pagesToRanges(pages: number[]): PageRange[] {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const out: PageRange[] = []
  for (const p of sorted) {
    const last = out[out.length - 1]
    if (last && p === last.to + 1) last.to = p
    else out.push({ from: p, to: p })
  }
  return out
}
