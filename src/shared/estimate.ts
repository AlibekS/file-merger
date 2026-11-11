// Прогноз размера PDF после сжатия по статистике содержимого.
// Считается мгновенно на стороне интерфейса, поэтому переключение
// пресетов сразу обновляет цифры «до → после».

import type { CompressPreset, ContentStats, ImageStat } from './types'

export interface PresetParams {
  /** Целевое разрешение цветных/полутоновых изображений (DPI), null — без ресэмплинга. */
  colorDpi: number | null
  /** Целевое разрешение монохромных изображений. */
  monoDpi: number | null
  /** Множитель размера JPEG после перекодирования с качеством пресета. */
  quality: number
  /** Во сколько раз уменьшается «не-растровая» часть (шрифты, векторы, структура). */
  otherFactor: number
}

export const PRESETS: Record<CompressPreset, PresetParams> = {
  light: { colorDpi: null, monoDpi: null, quality: 1, otherFactor: 0.88 },
  medium: { colorDpi: 150, monoDpi: 300, quality: 0.6, otherFactor: 0.8 },
  ultra: { colorDpi: 90, monoDpi: 200, quality: 0.45, otherFactor: 0.72 }
}

/** Площадь типичной страницы (A4) в квадратных дюймах — для оценки эффективного DPI сканов. */
const PAGE_SQ_IN = 8.27 * 11.69

function estimateImage(img: ImageStat, p: PresetParams): number {
  const [filter, enc] = img.filter.split('~')
  // ASCII85/ASCIIHex раздувают поток: реальные двоичные данные меньше.
  const binary = img.bytes * (enc === 'a85' ? 0.8 : enc === 'hex' ? 0.5 : 1)
  const pixels = img.w * img.h
  if (!pixels || !img.bytes) return img.bytes
  const perPixels = pixels // параметры одинаковы для всей группы
  const isMono = img.bpc === 1 || filter === 'JBIG2' || filter === 'CCITT'

  if (isMono) {
    if (!p.monoDpi) return binary
    const scale = Math.min(1, (PAGE_SQ_IN * p.monoDpi * p.monoDpi) / perPixels)
    // JBIG2 уже очень компактен — Ghostscript перекодирует в CCITT, выигрыша почти нет.
    if (filter === 'JBIG2') return binary
    return binary * (filter === 'CCITT' ? scale : Math.min(1, scale * 0.6))
  }

  if (!p.colorDpi) {
    // Лёгкий режим: JPEG проходят как есть, несжатые — Flate без потерь.
    return filter === 'Raw' ? binary * 0.5 : binary
  }
  const scale = Math.min(1, (PAGE_SQ_IN * p.colorDpi * p.colorDpi) / perPixels)
  // Уменьшение разрешения: размер JPEG растёт медленнее числа пикселей (детализация на пиксель выше).
  const resample = scale < 1 ? Math.pow(scale, 0.7) : 1
  const quality = scale < 1 ? p.quality : Math.min(1, p.quality + 0.3)
  const raw = filter === 'Raw' || filter === 'Flate' ? 0.35 : 1 // несжатые → JPEG
  return Math.min(img.bytes, binary * resample * quality * raw)
}

/** Прогнозируемый размер файла после сжатия (байты). */
export function estimateCompressed(stats: ContentStats, preset: CompressPreset): number {
  const p = PRESETS[preset]
  const other = Math.max(0, stats.fileSize - stats.imageBytes)
  let imgs = 0
  for (const img of stats.images) imgs += estimateImage(img, p)
  // Если сумма по группам меньше imageBytes (например, неполный скан) — пропорция.
  const counted = stats.images.reduce((s, i) => s + i.bytes, 0)
  if (counted > 0 && counted < stats.imageBytes) imgs *= stats.imageBytes / counted
  const est = other * p.otherFactor + imgs
  return Math.min(stats.fileSize, Math.round(est))
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—'
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  let v = bytes
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  const digits = u === 0 ? 0 : v < 10 ? 2 : v < 100 ? 1 : 0
  return `${v.toFixed(digits)} ${units[u]}`
}

export function savingsPercent(before: number, after: number): number {
  if (!before) return 0
  return Math.max(0, Math.round((1 - after / before) * 100))
}
