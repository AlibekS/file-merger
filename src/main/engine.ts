// Движок обработки PDF: Ghostscript для глубокого сжатия, qpdf для
// мгновенных структурных операций, pdf-lib (в фоновом потоке) — как резерв.

import { Worker } from 'node:worker_threads'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { stat, readdir, rename, copyFile } from 'node:fs/promises'
import { findTools } from './tools'
import { run, runQpdf, CancelledError } from './proc'
import { scanPdf } from './scanner'
import { tempSibling, commit, safeRm, ensureDir } from './fsutil'
import type { CompressPreset, FileInfo } from '../shared/types'
import type { WorkerTask, WorkerMessage } from './pdflib-worker'
import type { PageRange } from '../shared/ranges'
import { rangeLabel } from '../shared/ranges'

export class PasswordError extends Error {
  constructor(message = 'Файл защищён паролем') {
    super(message)
  }
}

export class EngineMissingError extends Error {}

/** Ошибка объединения, вызванная конкретным входным файлом. */
export class MergeInputError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly locked = false
  ) {
    super(message)
  }
}

// ───────────────────────── pdf-lib worker ─────────────────────────

function workerPath(): string {
  // В упакованном приложении worker распакован из asar.
  return join(__dirname, 'pdflib-worker.js').replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
}

function runWorker<T>(task: WorkerTask, signal?: AbortSignal, onProgress?: (f: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError())
    const w = new Worker(workerPath())
    const onAbort = (): void => {
      void w.terminate()
      reject(new CancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const finish = (): void => {
      signal?.removeEventListener('abort', onAbort)
      void w.terminate()
    }
    w.on('message', (m: WorkerMessage) => {
      if (m.type === 'progress') onProgress?.(m.fraction)
      else if (m.type === 'done') {
        finish()
        resolve(m.result as T)
      } else {
        finish()
        reject(m.encrypted ? new PasswordError('Файл зашифрован — для работы с ним установите qpdf') : new Error(m.message))
      }
    })
    w.on('error', (e) => {
      finish()
      reject(e)
    })
    w.postMessage(task)
  })
}

// ───────────────────────── helpers ─────────────────────────

const pw = (password?: string): string[] => (password ? [`--password=${password}`] : [])

function qpdfFailed(r: { code: number | null }): boolean {
  // 0 — успех, 3 — успех с предупреждениями (например, восстановленный повреждённый файл)
  return r.code !== 0 && r.code !== 3
}

function explainQpdf(stderr: string): Error {
  if (/invalid password/i.test(stderr)) return new PasswordError('Неверный пароль')
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean)
  const err = [...lines].reverse().find((l) => !/^WARNING/i.test(l)) ?? lines[lines.length - 1] ?? ''
  // Убираем путь к файлу и служебные префиксы — пользователю нужна суть.
  const reason = err
    .replace(/^qpdf:\s*/, '')
    .replace(/^.*?\.pdf(\s*\([^)]*\))?:\s*/i, '')
    .replace(/^operation for .*? failed:\s*/i, '')
    .slice(0, 160)
  return new Error(reason ? `Файл повреждён или не читается (${reason})` : 'Файл повреждён или не читается')
}

/** Ищет в сообщениях qpdf входной файл, на котором он остановился. */
function culpritPath(stderr: string, paths: string[]): string | null {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean)
  const errors = lines.filter((l) => !/^WARNING/i.test(l))
  for (const group of [errors, lines]) {
    for (let i = group.length - 1; i >= 0; i--) {
      let best: string | null = null
      for (const p of paths) if (group[i].includes(p) && (!best || p.length > best.length)) best = p
      if (best) return best
    }
  }
  return null
}

// ───────────────────────── анализ ─────────────────────────

export async function inspect(id: string, path: string, password?: string): Promise<FileInfo> {
  const { qpdf } = findTools()
  const info: FileInfo = { id, pages: null, needsPassword: false }
  try {
    info.stats = await scanPdf(path)
  } catch (e) {
    return { ...info, error: `Не удалось прочитать файл: ${(e as Error).message}` }
  }

  if (qpdf) {
    const req = await runQpdf(qpdf, ['--requires-password', path])
    if (req.code === 0) {
      // нужен пароль на открытие
      if (!password) return { ...info, needsPassword: true }
      const r = await runQpdf(qpdf, [...pw(password), '--show-npages', path])
      if (qpdfFailed(r)) {
        if (/invalid password/i.test(r.stderr)) return { ...info, needsPassword: true, passwordOk: false }
        return { ...info, error: explainQpdf(r.stderr).message }
      }
      return { ...info, passwordOk: true, pages: parseInt(r.stdout, 10) || null }
    }
    const r = await runQpdf(qpdf, ['--show-npages', path])
    if (qpdfFailed(r)) return { ...info, error: explainQpdf(r.stderr).message }
    info.pages = parseInt(r.stdout, 10) || null
    return info
  }

  // Без qpdf: страницы из сканера или (для небольших файлов) через pdf-lib.
  if (info.stats.encrypted) {
    const { gs } = findTools()
    if (!password) return { ...info, needsPassword: true, pages: info.stats.pageHint || null }
    if (!gs) return { ...info, error: 'Для зашифрованных файлов нужен qpdf или Ghostscript' }
    return { ...info, passwordOk: true, pages: info.stats.pageHint || null }
  }
  if (info.stats.pageHint > 0) {
    info.pages = info.stats.pageHint
  } else if (info.stats.fileSize < 300 * 1024 * 1024) {
    try {
      info.pages = await runWorker<number>({ op: 'count', path })
    } catch (e) {
      if (e instanceof PasswordError) return { ...info, needsPassword: true }
      console.warn('pdf-lib:', (e as Error).message)
      return { ...info, error: 'Файл повреждён или не читается' }
    }
  }
  return info
}

// ───────────────────────── сжатие ─────────────────────────

export function ghostscriptArgs(preset: CompressPreset, input: string, output: string, password?: string): string[] {
  const common = [
    '-sDEVICE=pdfwrite',
    '-dNOPAUSE',
    '-dBATCH',
    '-dSAFER',
    '-dCompatibilityLevel=1.6',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    '-dSubsetFonts=true',
    '-dEmbedAllFonts=true',
    '-dAutoRotatePages=/None',
    '-dNumRenderingThreads=1'
  ]
  if (password) common.push(`-sPDFPassword=${password}`)
  let params: string[]
  let distiller = ''
  if (preset === 'light') {
    // Без потерь: JPEG проходят как есть, остальное — Flate. Без ресэмплинга.
    params = [
      '-dPDFSETTINGS=/prepress',
      '-dPassThroughJPEGImages=true',
      '-dPassThroughJPXImages=true',
      '-dDownsampleColorImages=false',
      '-dDownsampleGrayImages=false',
      '-dDownsampleMonoImages=false',
      '-dAutoFilterColorImages=false',
      '-dAutoFilterGrayImages=false',
      '-dColorImageFilter=/FlateEncode',
      '-dGrayImageFilter=/FlateEncode'
    ]
  } else {
    const ultra = preset === 'ultra'
    const dpi = ultra ? 90 : 150
    const mono = ultra ? 200 : 300
    // QFactor ≈ 0.4 → JPEG ~78%, 0.9 → ~50%
    const q = ultra ? 0.9 : 0.4
    const samples = ultra ? '[2 1 1 2]' : '[1 1 1 1]'
    params = [
      `-dPDFSETTINGS=${ultra ? '/screen' : '/ebook'}`,
      '-dPassThroughJPEGImages=false',
      '-dPassThroughJPXImages=false',
      '-dDownsampleColorImages=true',
      '-dDownsampleGrayImages=true',
      '-dDownsampleMonoImages=true',
      '-dColorImageDownsampleType=/Bicubic',
      '-dGrayImageDownsampleType=/Bicubic',
      '-dMonoImageDownsampleType=/Subsample',
      `-dColorImageResolution=${dpi}`,
      `-dGrayImageResolution=${dpi}`,
      `-dMonoImageResolution=${mono}`,
      '-dColorImageDownsampleThreshold=1.0',
      '-dGrayImageDownsampleThreshold=1.0',
      '-dMonoImageDownsampleThreshold=1.0',
      '-dAutoFilterColorImages=false',
      '-dAutoFilterGrayImages=false',
      '-dColorImageFilter=/DCTEncode',
      '-dGrayImageFilter=/DCTEncode',
      '-dMonoImageFilter=/CCITTFaxEncode'
    ]
    if (ultra) params.push('-dPreserveAnnots=true', '-dPreserveMarkedContent=false', '-dCompressStreams=true')
    distiller =
      `<< /ColorImageDict << /QFactor ${q} /Blend 1 /HSamples ${samples} /VSamples ${samples} >> ` +
      `/GrayImageDict << /QFactor ${q} /Blend 1 /HSamples [1 1 1 1] /VSamples [1 1 1 1] >> ` +
      `/ColorACSImageDict << /QFactor ${q} /Blend 1 /HSamples ${samples} /VSamples ${samples} >> ` +
      `/GrayACSImageDict << /QFactor ${q} /Blend 1 /HSamples [1 1 1 1] /VSamples [1 1 1 1] >> >> setdistillerparams`
  }
  // Ghostscript трактует «%» в имени выходного файла как формат (%d — номер страницы).
  const out = [...common, ...params, `-sOutputFile=${output.replace(/%/g, '%%')}`]
  if (distiller) out.push('-c', distiller, '-f')
  out.push(input)
  if (preset === 'ultra') {
    // очистка метаданных документа
    out.push('-c', '[ /Title () /Author () /Subject () /Keywords () /Creator () /DOCINFO pdfmark', '-f')
  }
  return out
}

/** Финальный проход qpdf: object streams + перекомпрессия Flate. Без потерь. */
async function qpdfOptimize(
  input: string,
  output: string,
  opts: {
    signal?: AbortSignal
    /** Пароль для открытия input. */
    password?: string
    /** Зашифровать результат этим паролем (AES-256), чтобы защита исходного файла не терялась. */
    encryptWith?: string
    onFraction?: (f: number) => void
  } = {}
): Promise<void> {
  const { qpdf } = findTools()
  if (!qpdf) throw new EngineMissingError('qpdf не найден')
  const { signal, password, encryptWith, onFraction } = opts
  const r = await runQpdf(
    qpdf,
    [
      ...pw(password),
      ...(encryptWith ? ['--encrypt', encryptWith, encryptWith, '256', '--'] : ['--decrypt']),
      ...(onFraction ? ['--progress'] : []),
      '--object-streams=generate',
      '--compress-streams=y',
      '--recompress-flate',
      '--compression-level=9',
      '--remove-unreferenced-resources=yes',
      input,
      output
    ],
    {
      signal,
      onLine: onFraction
        ? (l) => {
            const m = /progress:\s*(\d+)%/.exec(l)
            if (m) onFraction(Math.min(0.95, Number(m[1]) / 100))
          }
        : undefined
    }
  )
  if (qpdfFailed(r)) throw explainQpdf(r.stderr)
}

export interface CompressResult {
  size: number
  optimal: boolean
}

export async function compressFile(
  input: string,
  output: string,
  preset: CompressPreset,
  opts: { password?: string; pages?: number | null; signal?: AbortSignal; onFraction?: (f: number) => void }
): Promise<CompressResult> {
  const { gs, qpdf } = findTools()
  const { size: originalSize } = await stat(input)
  const tmp1 = tempSibling(output)
  const tmp2 = tempSibling(output)
  const tmp3 = tempSibling(output)
  const { signal, onFraction, password } = opts
  try {
    let produced: string
    if (preset === 'light') {
      // «Лёгкая» — строго без потерь: только структурная оптимизация qpdf.
      // Ghostscript переписывает документ и может сломать формы, вложения и подписи.
      if (qpdf) {
        await qpdfOptimize(input, tmp2, { signal, password, encryptWith: password, onFraction })
      } else {
        if (password) throw new PasswordError('Для зашифрованных файлов нужен qpdf')
        await runWorker({ op: 'resave', path: input, out: tmp2 }, signal)
      }
      produced = tmp2
    } else if (gs) {
      const total = opts.pages ?? 0
      const r = await run(gs, ghostscriptArgs(preset, input, tmp1, password), {
        signal,
        onLine: (l) => {
          const m = /^Page (\d+)/.exec(l)
          if (m && total) onFraction?.(Math.min(0.95, (Number(m[1]) / total) * 0.9))
        }
      })
      const text = r.stdout + r.stderr
      // Ghostscript может завершиться с кодом 0, но выдать пустой документ.
      const fatal =
        /requires a password|Couldn't initialise file|No pages will be processed|Unrecoverable error|Error: \/syntaxerror/i.test(
          text
        )
      if (r.code !== 0 || fatal) {
        if (/password/i.test(text)) throw new PasswordError(password ? 'Неверный пароль' : 'Файл защищён паролем')
        const line = text.split('\n').find((x) => /error/i.test(x)) ?? text.split('\n').find(Boolean) ?? ''
        throw new Error(`Файл повреждён или не читается: ${line.trim().slice(0, 200)}`)
      }
      produced = tmp1
      if (qpdf) {
        try {
          // Ghostscript снимает шифрование — возвращаем защиту тем же паролем.
          await qpdfOptimize(tmp1, tmp2, { signal, encryptWith: password })
          produced = tmp2
        } catch (e) {
          // Без пароля можно оставить результат Ghostscript; с паролем — нельзя,
          // иначе защищённый документ молча сохранится открытым.
          if (e instanceof CancelledError || password) throw e
        }
      } else if (password) {
        throw new PasswordError('Для зашифрованных файлов нужен qpdf')
      }
    } else {
      throw new EngineMissingError(
        'Ghostscript не найден — режимы «Средняя» и «Ультра» недоступны. Установите Ghostscript (см. README).'
      )
    }

    // Контроль целостности: число страниц результата должно совпасть с исходным.
    if (qpdf && opts.pages) {
      const n = await runQpdf(qpdf, [...pw(password), '--show-npages', produced], { signal })
      const got = parseInt(n.stdout, 10)
      if (!qpdfFailed(n) && got && got !== opts.pages) {
        throw new Error(`Сжатие дало ${got} стр. вместо ${opts.pages} — файл повреждён или не поддерживается`)
      }
    }
    const { size } = await stat(produced)
    if (size >= originalSize) {
      // Файл уже оптимально сжат — сохраняем копию оригинала (через временный файл,
      // чтобы прерванное копирование не оставило обрезанный результат).
      await copyFile(input, tmp3)
      if (signal?.aborted) throw new CancelledError()
      await commit(tmp3, output)
      return { size: originalSize, optimal: true }
    }
    await commit(produced, output)
    return { size, optimal: false }
  } finally {
    await safeRm(tmp1)
    await safeRm(tmp2)
    await safeRm(tmp3)
  }
}

// ───────────────────────── объединение ─────────────────────────

export async function mergeFiles(
  inputs: { path: string; password?: string }[],
  output: string,
  opts: { signal?: AbortSignal; onFraction?: (f: number) => void }
): Promise<number> {
  const { qpdf } = findTools()
  const tmp = tempSibling(output)
  try {
    if (qpdf) {
      const args = ['--empty', '--progress', '--pages']
      for (const f of inputs) args.push(f.path, ...pw(f.password), '1-z')
      args.push('--', tmp)
      const r = await runQpdf(qpdf, args, {
        signal: opts.signal,
        onLine: (l) => {
          const m = /progress:\s*(\d+)%/.exec(l)
          if (m) opts.onFraction?.(Number(m[1]) / 100)
        }
      })
      if (qpdfFailed(r)) {
        const err = explainQpdf(r.stderr)
        const bad = culpritPath(r.stderr, inputs.map((f) => f.path))
        throw bad ? new MergeInputError(err.message, bad, err instanceof PasswordError) : err
      }
    } else {
      if (inputs.some((f) => f.password)) throw new PasswordError('Для зашифрованных файлов нужен qpdf')
      await runWorker({ op: 'merge', inputs: inputs.map((f) => f.path), out: tmp }, opts.signal, opts.onFraction)
    }
    await commit(tmp, output)
    return (await stat(output)).size
  } finally {
    await safeRm(tmp)
  }
}

// ───────────────────────── разделение ─────────────────────────

const pad = (n: number): string => String(n).padStart(3, '0')

/** Каждая страница → отдельный файл page_001.pdf … в папке outDir. */
export async function splitAllPages(
  input: string,
  outDir: string,
  opts: { password?: string; pages?: number | null; signal?: AbortSignal; onFraction?: (f: number) => void }
): Promise<string[]> {
  const { qpdf } = findTools()
  await ensureDir(outDir)
  if (qpdf) {
    const work = join(outDir, `.split-${Date.now().toString(36)}`)
    await ensureDir(work)
    try {
      const r = await runQpdf(
        qpdf,
        [...pw(opts.password), '--decrypt', '--split-pages=1', input, join(work, 'page_%d.pdf')],
        { signal: opts.signal }
      )
      if (qpdfFailed(r)) throw explainQpdf(r.stderr)
      const names = (await readdir(work)).filter((n) => /^page_\d+\.pdf$/.test(n))
      const outs: string[] = []
      for (const n of names) {
        const num = Number(/(\d+)/.exec(n)![1])
        const target = join(outDir, `page_${pad(num)}.pdf`)
        await rename(join(work, n), target)
        outs.push(target)
      }
      return outs.sort()
    } finally {
      await safeRm(work)
    }
  }
  if (opts.password) throw new PasswordError('Для зашифрованных файлов нужен qpdf')
  const count = opts.pages ?? (await runWorker<number>({ op: 'count', path: input }, opts.signal))
  const outs = Array.from({ length: count }, (_, i) => join(outDir, `page_${pad(i + 1)}.pdf`))
  await runWorker({ op: 'splitAll', path: input, outs }, opts.signal, opts.onFraction)
  return outs
}

/** Извлекает набор диапазонов в один файл. */
export async function extractRanges(
  input: string,
  ranges: PageRange[],
  output: string,
  opts: { password?: string; signal?: AbortSignal }
): Promise<void> {
  const { qpdf } = findTools()
  const tmp = tempSibling(output)
  try {
    if (qpdf) {
      const spec = ranges.map(rangeLabel).join(',')
      const r = await runQpdf(qpdf, [...pw(opts.password), '--decrypt', input, '--pages', '.', spec, '--', tmp], {
        signal: opts.signal
      })
      if (qpdfFailed(r)) throw explainQpdf(r.stderr)
    } else {
      if (opts.password) throw new PasswordError('Для зашифрованных файлов нужен qpdf')
      const pages: number[] = []
      for (const r of ranges) for (let p = r.from; p <= r.to; p++) pages.push(p)
      await runWorker({ op: 'extract', path: input, pages, out: tmp }, opts.signal)
    }
    await commit(tmp, output)
  } finally {
    await safeRm(tmp)
  }
}

// ───────────────────────── пробное сжатие для прогноза ─────────────────────────

/**
 * Быстрый прогноз: вырезаем 1–2 репрезентативные страницы, сжимаем их каждым
 * пресетом и возвращаем коэффициенты «после/до». Работает в фоне, уточняя
 * мгновенную эвристику.
 */
export async function sampleRatios(
  input: string,
  pages: number,
  password?: string,
  signal?: AbortSignal
): Promise<Record<CompressPreset, number> | null> {
  const { gs, qpdf } = findTools()
  if (!gs || !qpdf || !pages) return null
  const dir = join(tmpdir(), `pdfstudio-sample-${randomBytes(5).toString('hex')}`)
  await ensureDir(dir)
  try {
    const sample = join(dir, 'in.pdf')
    const picks = pages >= 3 ? `1,${Math.ceil(pages / 2)}` : '1'
    const r = await runQpdf(qpdf, [...pw(password), '--decrypt', input, '--pages', '.', picks, '--', sample], { signal })
    if (qpdfFailed(r)) return null
    const inSize = (await stat(sample)).size
    const out: Partial<Record<CompressPreset, number>> = {}
    for (const preset of ['light', 'medium', 'ultra'] as CompressPreset[]) {
      const o1 = join(dir, `${preset}.pdf`)
      const o2 = join(dir, `${preset}-q.pdf`)
      let size: number
      if (preset === 'light') {
        // тот же путь, что и при настоящем сжатии: только qpdf
        await qpdfOptimize(sample, o2, { signal })
        size = (await stat(o2)).size
      } else {
        const g = await run(gs, ghostscriptArgs(preset, sample, o1), { signal })
        if (g.code !== 0) return null
        const q = await runQpdf(qpdf, ['--object-streams=generate', '--compress-streams=y', '--recompress-flate', o1, o2], {
          signal
        })
        size = (await stat(qpdfFailed(q) ? o1 : o2)).size
      }
      out[preset] = Math.min(1, size / inSize)
    }
    return out as Record<CompressPreset, number>
  } catch {
    return null
  } finally {
    await safeRm(dir)
  }
}
