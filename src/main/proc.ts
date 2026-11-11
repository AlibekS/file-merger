import { spawn } from 'node:child_process'
import { writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export class CancelledError extends Error {
  constructor() {
    super('Отменено')
  }
}

/** Запускает внешний процесс; при отмене через signal процесс завершается. */
export function run(
  cmd: string,
  args: string[],
  opts: { signal?: AbortSignal; onLine?: (line: string) => void } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new CancelledError())
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let lineBuf = ''
    const MAX = 256 * 1024
    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString('utf8')
      if (stdout.length < MAX) stdout += s
      if (opts.onLine) {
        lineBuf += s
        const lines = lineBuf.split(/\r?\n|\r/)
        lineBuf = lines.pop() ?? ''
        for (const l of lines) opts.onLine(l)
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString('utf8')
      if (stderr.length < MAX) stderr += s
      if (opts.onLine) for (const l of s.split(/\r?\n|\r/)) if (l) opts.onLine(l)
    })
    child.on('error', (e) => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(e)
    })
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      if (opts.signal?.aborted) return reject(new CancelledError())
      resolve({ code, stdout, stderr })
    })
  })
}

/**
 * qpdf с аргументами из временного файла (@argfile): нет ограничения длины
 * командной строки (важно при объединении тысяч файлов) и пароли не видны в списке процессов.
 */
export async function runQpdf(
  qpdf: string,
  args: string[],
  opts: { signal?: AbortSignal; onLine?: (line: string) => void } = {}
): Promise<RunResult> {
  const argFile = join(tmpdir(), `pdfstudio-${randomBytes(6).toString('hex')}.args`)
  await writeFile(argFile, args.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 })
  try {
    return await run(qpdf, [`@${argFile}`], opts)
  } finally {
    await rm(argFile, { force: true })
  }
}

/**
 * Пул задач с ограничением параллелизма. Если задан weight, одновременно в работе
 * держится не больше budget суммарного «веса» (например, байт входных файлов):
 * мелкие файлы идут по числу ядер, крупные — по одному-два. Задача, которая одна
 * тяжелее бюджета, запускается в одиночку.
 */
export function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
  weight?: { of: (item: T) => number; budget: number }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const limit = Math.max(1, concurrency)
    let next = 0
    let active = 0
    let load = 0
    let failed = false
    let error: unknown
    const pump = (): void => {
      while (next < items.length && !signal?.aborted && !failed && active < limit) {
        const w = weight ? Math.max(0, weight.of(items[next])) : 0
        if (weight && active > 0 && load + w > weight.budget) break
        const i = next++
        active++
        load += w
        let p: Promise<void>
        try {
          p = fn(items[i], i)
        } catch (e) {
          p = Promise.reject(e)
        }
        p.catch((e) => {
          if (!failed) {
            failed = true
            error = e
          }
        }).finally(() => {
          active--
          load -= w
          pump()
        })
      }
      if (active === 0 && (failed || signal?.aborted || next >= items.length)) {
        if (failed) reject(error)
        else resolve()
      }
    }
    pump()
  })
}
