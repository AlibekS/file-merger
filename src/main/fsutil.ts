import { readdir, stat, mkdir, rename, rm, rmdir, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, basename, extname, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { FileEntry } from '../shared/types'

let idCounter = 0
export const newId = (): string => `f${Date.now().toString(36)}${(idCounter++).toString(36)}`

const isPdf = (p: string): boolean => extname(p).toLowerCase() === '.pdf'

/** Разворачивает выбранные пути: папки обходятся рекурсивно, берутся только .pdf. */
export async function collectPdfs(paths: string[]): Promise<FileEntry[]> {
  const out: FileEntry[] = []
  const seen = new Set<string>()

  const visit = async (p: string, depth: number): Promise<void> => {
    let st
    try {
      st = await stat(p)
    } catch {
      return
    }
    if (st.isDirectory()) {
      if (depth > 64) return
      let names: string[]
      try {
        names = await readdir(p)
      } catch {
        return
      }
      names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      for (const n of names) {
        if (n.startsWith('.')) continue
        await visit(join(p, n), depth + 1)
      }
    } else if (st.isFile() && isPdf(p) && !seen.has(p)) {
      seen.add(p)
      out.push({ id: newId(), path: p, name: basename(p), size: st.size })
    }
  }

  for (const p of paths) await visit(p, 0)
  return out
}

export const stem = (p: string): string => basename(p, extname(p))

/** Пути, зарезервированные текущими заданиями (чтобы параллельные задачи не заняли одно имя). */
const reserved = new Set<string>()

const MAX_NAME = 255
/** Классический лимит Windows на полный путь: gs.exe и qpdf.exe длинные пути не открывают. */
const WIN_MAX_PATH = 259
/** Запас под суффикс « (NN)» при конфликте имён. */
const SUFFIX_RESERVE = 8
const MIN_BASE = 8

/**
 * Усекает имя (без расширения) так, чтобы итоговый путь уложился в лимиты ОС:
 * 255 на имя файла и MAX_PATH на полный путь в Windows.
 */
export function fitBase(dir: string, base: string, ext: string): string {
  const win = process.platform === 'win32'
  // NTFS считает символы UTF-16, остальные ФС — байты UTF-8.
  const len = (s: string): number => (win ? s.length : Buffer.byteLength(s, 'utf8'))
  let room = MAX_NAME - len(ext) - SUFFIX_RESERVE
  if (win) room = Math.min(room, WIN_MAX_PATH - dir.length - 1 - ext.length - SUFFIX_RESERVE)
  room = Math.max(MIN_BASE, room)
  if (len(base) <= room) return base
  let out = base
  while (out.length > 1 && len(out) > room) out = out.slice(0, -1)
  // не оставляем половину суррогатной пары и хвостовые пробелы/точки (Windows их не любит)
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1)
  return out.replace(/[ .]+$/, '') || base.slice(0, 1)
}

/** Возвращает свободный путь: «name.pdf», «name (2).pdf», … и резервирует его. */
export function uniquePath(dir: string, fileName: string): string {
  const ext = extname(fileName)
  const base = fitBase(dir, basename(fileName, ext), ext)
  let candidate = join(dir, base + ext)
  for (let n = 2; existsSync(candidate) || reserved.has(candidate); n++) {
    candidate = join(dir, `${base} (${n})${ext}`)
  }
  reserved.add(candidate)
  return candidate
}

export function release(path: string): void {
  reserved.delete(path)
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

/** Временный файл рядом с целевым — потом атомарно переименовывается. */
export function tempSibling(target: string): string {
  // Короткое имя, не зависящее от целевого: не упирается в лимит длины и не содержит спецсимволов.
  return join(dirname(target), `.pdfstudio-${randomBytes(4).toString('hex')}.part`)
}

/** Удаляет папку, только если она пуста. */
export async function rmDirIfEmpty(dir: string): Promise<void> {
  await rmdir(dir).catch(() => undefined)
}

export async function commit(tmp: string, target: string): Promise<void> {
  try {
    await rename(tmp, target)
  } catch {
    // Например, другой том — копируем.
    await copyFile(tmp, target)
    await rm(tmp, { force: true })
  }
}

export async function safeRm(p: string): Promise<void> {
  await rm(p, { force: true, recursive: true }).catch(() => undefined)
}

export function sanitizeFileName(name: string, fallback: string): string {
  let n = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
  if (!n) n = fallback
  if (!/\.pdf$/i.test(n)) n += '.pdf'
  return n
}
