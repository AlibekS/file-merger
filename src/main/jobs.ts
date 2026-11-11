// Менеджер заданий: пул фоновых обработчиков (по числу ядер), прогресс, отмена.

import { cpus } from 'node:os'
import { dirname, join } from 'node:path'
import type { WebContents } from 'electron'
import type { FileProgress, JobFile, JobProgress, JobRequest, FileStatus } from '../shared/types'
import { compressFile, mergeFiles, splitAllPages, extractRanges, PasswordError } from './engine'
import { CancelledError, runPool } from './proc'
import { uniquePath, release, stem, ensureDir, sanitizeFileName } from './fsutil'
import { parseRanges, clampRanges, pagesToRanges, rangeLabel, type PageRange } from '../shared/ranges'

interface ActiveJob {
  id: string
  controller: AbortController
}

const jobs = new Map<string, ActiveJob>()
let jobCounter = 0

export function cancelJob(id: string): void {
  jobs.get(id)?.controller.abort()
}

export function concurrency(): number {
  return Math.max(1, cpus().length)
}

class Reporter {
  private queue = new Map<string, FileProgress>()
  private timer: NodeJS.Timeout | null = null
  private fractions = new Map<string, number>()
  done = 0

  constructor(
    private wc: WebContents,
    private jobId: string,
    private total: number
  ) {}

  file(fileId: string, status: FileStatus, extra: Partial<FileProgress> = {}): void {
    const prev = this.queue.get(fileId)
    this.queue.set(fileId, { ...prev, jobId: this.jobId, fileId, status, ...extra })
    if (status === 'processing') this.fractions.set(fileId, extra.fraction ?? 0)
    else this.fractions.delete(fileId)
    if (['done', 'optimal', 'error', 'skipped', 'locked', 'cancelled'].includes(status)) this.done++
    this.schedule()
  }

  fraction(fileId: string, f: number): void {
    this.fractions.set(fileId, f)
    const prev = this.queue.get(fileId)
    this.queue.set(fileId, { ...prev, jobId: this.jobId, fileId, status: 'processing', fraction: f })
    this.schedule()
  }

  private schedule(): void {
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 80)
  }

  private overall(): number {
    let partial = 0
    for (const f of this.fractions.values()) partial += f
    return Math.min(1, (this.done + partial) / Math.max(1, this.total))
  }

  flush(final?: Partial<JobProgress>): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.wc.isDestroyed()) return
    if (this.queue.size) {
      this.wc.send('job:file', [...this.queue.values()])
      this.queue.clear()
    }
    const p: JobProgress = {
      jobId: this.jobId,
      done: Math.min(this.done, this.total),
      total: this.total,
      fraction: final?.finished ? 1 : this.overall(),
      finished: false,
      ...final
    }
    this.wc.send('job:progress', p)
  }
}

function errorStatus(e: unknown): { status: FileStatus; message: string } {
  if (e instanceof CancelledError) return { status: 'cancelled', message: 'Отменено' }
  if (e instanceof PasswordError) return { status: 'locked', message: e.message }
  return { status: 'error', message: e instanceof Error ? e.message : String(e) }
}

function outDirFor(file: JobFile, req: JobRequest): string {
  return req.output.mode === 'folder' && req.output.dir ? req.output.dir : dirname(file.path)
}

export function startJob(wc: WebContents, req: JobRequest): string {
  const id = `job${++jobCounter}`
  const controller = new AbortController()
  jobs.set(id, { id, controller })
  const signal = controller.signal

  const total = req.kind === 'merge' ? 1 : req.files.length
  const rep = new Reporter(wc, id, total)

  const finish = (extra: Partial<JobProgress> = {}): void => {
    jobs.delete(id)
    rep.flush({ finished: true, cancelled: signal.aborted, ...extra })
  }

  const run = async (): Promise<Partial<JobProgress>> => {
    for (const f of req.files) rep.file(f.id, 'queued')

    if (req.kind === 'compress') {
      const firstDir = req.files[0] ? outDirFor(req.files[0], req) : undefined
      await runPool(
        req.files,
        concurrency(),
        async (f) => {
          const dir = outDirFor(f, req)
          let name = `${stem(f.path)}.pdf`
          if (req.output.mode === 'source' || join(dir, name) === f.path) name = `${stem(f.path)}_compressed.pdf`
          const target = uniquePath(dir, name)
          rep.file(f.id, 'processing', { fraction: 0 })
          try {
            await ensureDir(dir)
            const r = await compressFile(f.path, target, req.preset, {
              password: f.password,
              pages: f.pages,
              signal,
              onFraction: (x) => rep.fraction(f.id, x)
            })
            rep.file(f.id, r.optimal ? 'optimal' : 'done', {
              outputSize: r.size,
              outputPath: target,
              message: r.optimal ? 'Файл уже оптимально сжат, экономия 0%' : undefined
            })
          } catch (e) {
            const { status, message } = errorStatus(e)
            rep.file(f.id, status, { message })
          } finally {
            release(target)
          }
        },
        signal
      )
      return { outputDir: req.output.mode === 'folder' ? req.output.dir : firstDir }
    }

    if (req.kind === 'merge') {
      const dir = outDirFor(req.files[0], req)
      await ensureDir(dir)
      const target = uniquePath(dir, sanitizeFileName(req.fileName, 'merged_document.pdf'))
      for (const f of req.files) rep.file(f.id, 'processing', { fraction: 0 })
      rep.done = 0
      try {
        const size = await mergeFiles(req.files, target, {
          signal,
          onFraction: (x) => rep.fraction('__merge', x)
        })
        rep.done = 0
        for (const f of req.files) rep.file(f.id, 'done')
        rep.done = 1
        return { outputPath: target, outputDir: dir, ...{ outputSize: size } }
      } catch (e) {
        const { status, message } = errorStatus(e)
        for (const f of req.files) rep.file(f.id, status === 'locked' ? 'error' : status, { message })
        rep.done = 1
        return {}
      } finally {
        release(target)
      }
    }

    // split
    const parsed = req.mode === 'ranges' ? parseRanges(req.ranges ?? '') : null
    let lastDir: string | undefined
    await runPool(
      req.files,
      concurrency(),
      async (f) => {
        const dir = outDirFor(f, req)
        lastDir = dir
        const base = stem(f.path)
        rep.file(f.id, 'processing', { fraction: 0 })
        const reservedPaths: string[] = []
        const reserve = (d: string, n: string): string => {
          const p = uniquePath(d, n)
          reservedPaths.push(p)
          return p
        }
        try {
          if (req.mode === 'all') {
            const folder = reserve(dir, `${base}_split`)
            const outs = await splitAllPages(f.path, folder, {
              password: f.password,
              pages: f.pages,
              signal,
              onFraction: (x) => rep.fraction(f.id, x)
            })
            rep.file(f.id, 'done', { outputPath: folder, outputCount: outs.length })
            return
          }
          let ranges: PageRange[]
          if (req.mode === 'ranges') {
            if (!parsed || parsed.error) throw new Error(parsed?.error ?? 'Неверные диапазоны')
            ranges = f.pages ? clampRanges(parsed.ranges, f.pages) : parsed.ranges
          } else {
            ranges = pagesToRanges(req.pagesByFile?.[f.id] ?? [])
          }
          if (!ranges.length) {
            rep.file(f.id, 'skipped', { message: 'Нет выбранных страниц в пределах документа' })
            return
          }
          await ensureDir(dir)
          if (req.combine) {
            const target = reserve(dir, `${base}_split.pdf`)
            await extractRanges(f.path, ranges, target, { password: f.password, signal })
            rep.file(f.id, 'done', { outputPath: target, outputCount: 1 })
          } else {
            const folder = reserve(dir, `${base}_split`)
            await ensureDir(folder)
            for (let i = 0; i < ranges.length; i++) {
              const r = ranges[i]
              const label = req.mode === 'visual' && r.from === r.to ? `page_${String(r.from).padStart(3, '0')}` : `${base}_pages_${rangeLabel(r)}`
              const target = reserve(folder, `${label}.pdf`)
              await extractRanges(f.path, [r], target, { password: f.password, signal })
              rep.fraction(f.id, (i + 1) / ranges.length)
            }
            rep.file(f.id, 'done', { outputPath: folder, outputCount: ranges.length })
          }
        } catch (e) {
          const { status, message } = errorStatus(e)
          rep.file(f.id, status, { message })
        } finally {
          reservedPaths.forEach(release)
        }
      },
      signal
    )
    return { outputDir: req.output.mode === 'folder' ? req.output.dir : lastDir }
  }

  run()
    .then((extra) => {
      if (signal.aborted) {
        // всё, что не успело начаться, помечаем отменённым
        wc.send('job:cancelled', id)
      }
      finish(extra)
    })
    .catch((e) => {
      console.error(e)
      finish()
    })

  return id
}
