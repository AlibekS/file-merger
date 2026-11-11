// Быстрый потоковый сканер структуры PDF.
//
// Читает файл кусками и ищет словари растровых изображений (/Subtype /Image),
// не загружая файл в память целиком. Данные изображений с известной длиной
// (/Length N) пропускаются без чтения — поэтому даже многогигабайтные сканы
// анализируются за доли секунды: читаются только словари объектов.

import { open } from 'node:fs/promises'
import type { ContentStats, ImageStat } from '../shared/types'

const CHUNK = 4 * 1024 * 1024
const OVERLAP = 8 * 1024
const DICT_WINDOW = 4096

const B_IMAGE = Buffer.from('/Image')
const B_ENDSTREAM = Buffer.from('endstream')
const B_TYPE = Buffer.from('/Type')
const B_ENCRYPT = Buffer.from('/Encrypt')

function isDelimiter(byte: number | undefined): boolean {
  if (byte === undefined) return true
  // пробельные и разделители PDF
  return (
    byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0x0c || byte === 0x00 ||
    byte === 0x2f || byte === 0x3c || byte === 0x3e || byte === 0x5b || byte === 0x5d || byte === 0x28 ||
    byte === 0x29 || byte === 0x7b || byte === 0x7d || byte === 0x25
  )
}

function isWs(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0x0c || byte === 0x00
}

function classifyFilter(dict: string): string {
  const m = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(dict)
  if (!m) return 'Raw'
  const names = m[1].match(/\/[A-Za-z0-9]+/g) ?? []
  // Кодирование изображения определяется последним фильтром в цепочке.
  const last = names[names.length - 1] ?? ''
  const enc = names.some((n) => /ASCII85|A85/.test(n)) ? '~a85' : names.some((n) => /ASCIIHex|AHx/.test(n)) ? '~hex' : ''
  const kind = /DCT/.test(last)
    ? 'DCT'
    : /JBIG2/.test(last)
      ? 'JBIG2'
      : /CCITT/.test(last)
        ? 'CCITT'
        : /JPX/.test(last)
          ? 'JPX'
          : /Flate|LZW|Fl\b|RunLength/.test(last)
            ? 'Flate'
            : /ASCII|A85|AHx/.test(last)
              ? 'Raw'
              : 'other'
  return kind + enc
}

function colorComponents(dict: string): number {
  if (/\/ImageMask\s+true/.test(dict)) return 1
  const m = /\/ColorSpace\s*(\[\s*\/[A-Za-z]+|\/[A-Za-z]+|\d+\s+\d+\s+R)/.exec(dict)
  if (!m) return 3
  const cs = m[1]
  if (/Gray|CalGray|Indexed|Separation/.test(cs)) return 1
  if (/CMYK|DeviceN/.test(cs)) return 4
  return 3
}

function num(dict: string, key: string): number | null {
  const m = new RegExp('/' + key + '\\s+(\\d+)(?!\\d|\\s+\\d+\\s+R)').exec(dict)
  return m ? Number(m[1]) : null
}

interface Pending {
  key: string
  start: number
}

/**
 * Сканирует PDF и возвращает статистику изображений.
 * Никогда не бросает исключение из-за «странного» содержимого — максимум вернёт неполные данные.
 */
export async function scanPdf(path: string): Promise<ContentStats> {
  const fh = await open(path, 'r')
  try {
    const { size } = await fh.stat()
    const groups = new Map<string, ImageStat>()
    let imageBytes = 0
    let pageHint = 0
    let encrypted = false
    const buf = Buffer.allocUnsafe(CHUNK + OVERLAP)

    const addImage = (key: string, bytes: number): void => {
      const g = groups.get(key)
      if (!g) return
      g.bytes += bytes
      imageBytes += bytes
    }
    const registerGroup = (stat: Omit<ImageStat, 'bytes' | 'count'>): string => {
      const key = `${stat.w}x${stat.h}x${stat.bpc}x${stat.comps}x${stat.filter}`
      const g = groups.get(key)
      if (g) g.count++
      else groups.set(key, { ...stat, bytes: 0, count: 1 })
      return key
    }

    let pos = 0 // абсолютная позиция начала текущего чтения
    let doneUntil = 0 // всё до этой позиции уже обработано
    let pending: Pending | null = null // изображение с косвенной длиной, ждём endstream

    while (pos < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK + OVERLAP, size - pos), pos)
      if (bytesRead <= 0) break
      const view = buf.subarray(0, bytesRead)
      const chunkEnd = pos + bytesRead
      let nextPos = chunkEnd >= size ? size : chunkEnd - OVERLAP

      // Изображение с косвенной длиной: ищем конец его данных.
      if (pending) {
        const local = view.indexOf(B_ENDSTREAM, Math.max(0, pending.start - pos))
        if (local < 0) {
          // данные ещё не закончились — читаем дальше
          pos = Math.max(nextPos, pos + 1)
          doneUntil = pos
          continue
        }
        addImage(pending.key, pos + local - pending.start)
        doneUntil = pos + local
        pending = null
      }

      // Подсчёт страниц и признак шифрования (только в непросмотренной части).
      const from = Math.max(0, doneUntil - pos)
      for (let i = view.indexOf(B_TYPE, from); i >= 0; i = view.indexOf(B_TYPE, i + 5)) {
        let j = i + 5
        while (j < view.length && isWs(view[j])) j++
        // /Page, но не /Pages и не /PageLabel
        if (
          view[j] === 0x2f && view[j + 1] === 0x50 && view[j + 2] === 0x61 && view[j + 3] === 0x67 &&
          view[j + 4] === 0x65 && isDelimiter(view[j + 5])
        ) {
          if (pos + i < chunkEnd - OVERLAP || chunkEnd >= size) pageHint++
        }
      }
      if (!encrypted) {
        for (let i = view.indexOf(B_ENCRYPT, from); i >= 0; i = view.indexOf(B_ENCRYPT, i + 8)) {
          if (isDelimiter(view[i + 8])) {
            encrypted = true
            break
          }
        }
      }

      // Поиск словарей изображений.
      let i = view.indexOf(B_IMAGE, from)
      while (i >= 0) {
        const abs = pos + i
        // Совпадения в зоне перекрытия обработаем в следующем куске (там будет полный контекст).
        if (abs >= nextPos && chunkEnd < size) break
        if (!isDelimiter(view[i + 6])) {
          i = view.indexOf(B_IMAGE, i + 6)
          continue
        }
        // перед /Image должно стоять /Subtype
        let k = i - 1
        while (k >= 0 && isWs(view[k])) k--
        const isSubtype = k >= 7 && view.toString('latin1', k - 7, k + 1) === '/Subtype'
        if (!isSubtype) {
          i = view.indexOf(B_IMAGE, i + 6)
          continue
        }
        const wStart = Math.max(0, i - DICT_WINDOW)
        const wEnd = Math.min(view.length, i + DICT_WINDOW)
        const win = view.toString('latin1', wStart, wEnd)
        const rel = i - wStart
        const objIdx = win.lastIndexOf(' obj', rel)
        const streamIdx = win.indexOf('stream', rel)
        if (streamIdx < 0) {
          i = view.indexOf(B_IMAGE, i + 6)
          continue
        }
        const dict = win.slice(objIdx >= 0 ? objIdx : 0, streamIdx)
        const w = num(dict, 'Width') ?? 0
        const h = num(dict, 'Height') ?? 0
        const mask = /\/ImageMask\s+true/.test(dict)
        const bpc = mask ? 1 : (num(dict, 'BitsPerComponent') ?? 8)
        const key = registerGroup({ w, h, bpc, comps: colorComponents(dict), filter: classifyFilter(dict) })

        // начало данных: после "stream" + EOL
        let dataStart = wStart + streamIdx + 6
        if (view[dataStart] === 0x0d) dataStart++
        if (view[dataStart] === 0x0a) dataStart++
        const absData = pos + dataStart
        const len = num(dict, 'Length')
        if (len !== null) {
          addImage(key, len)
          const absEnd = absData + len
          if (absEnd > nextPos) {
            // Пропускаем данные изображения, не читая их.
            nextPos = absEnd
            break
          }
          i = view.indexOf(B_IMAGE, Math.max(i + 6, dataStart + len))
        } else {
          const e = view.indexOf(B_ENDSTREAM, dataStart)
          if (e >= 0) {
            addImage(key, e - dataStart)
            i = view.indexOf(B_IMAGE, e)
          } else {
            pending = { key, start: absData }
            nextPos = chunkEnd >= size ? size : Math.max(absData, chunkEnd - OVERLAP)
            break
          }
        }
      }

      doneUntil = Math.max(doneUntil, nextPos)
      if (nextPos <= pos) nextPos = pos + 1
      pos = nextPos
    }

    if (pending) addImage(pending.key, size - pending.start)

    return {
      fileSize: size,
      imageBytes: Math.min(imageBytes, size),
      images: [...groups.values()],
      pageHint,
      encrypted
    }
  } finally {
    await fh.close()
  }
}
