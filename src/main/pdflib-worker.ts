// Фоновый поток для резервного движка на pdf-lib (используется, когда qpdf
// не установлен). Работает в worker_threads, чтобы не блокировать main-процесс.

import { parentPort } from 'node:worker_threads'
import { readFile, writeFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'

export type WorkerTask =
  | { op: 'count'; path: string }
  | { op: 'merge'; inputs: string[]; out: string }
  | { op: 'extract'; path: string; pages: number[]; out: string }
  | { op: 'splitAll'; path: string; outs: string[] }
  | { op: 'resave'; path: string; out: string }

export type WorkerMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; result?: unknown }
  | { type: 'error'; message: string; encrypted?: boolean }

const post = (m: WorkerMessage): void => parentPort!.postMessage(m)

async function load(path: string): Promise<PDFDocument> {
  const bytes = await readFile(path)
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  return doc
}

async function handle(t: WorkerTask): Promise<unknown> {
  switch (t.op) {
    case 'count': {
      const doc = await load(t.path)
      return doc.getPageCount()
    }
    case 'merge': {
      const out = await PDFDocument.create()
      for (let i = 0; i < t.inputs.length; i++) {
        const src = await load(t.inputs[i])
        const pages = await out.copyPages(src, src.getPageIndices())
        pages.forEach((p) => out.addPage(p))
        post({ type: 'progress', fraction: ((i + 1) / t.inputs.length) * 0.9 })
      }
      await writeFile(t.out, await out.save({ useObjectStreams: true }))
      return null
    }
    case 'extract': {
      const src = await load(t.path)
      const out = await PDFDocument.create()
      const pages = await out.copyPages(src, t.pages.map((p) => p - 1))
      pages.forEach((p) => out.addPage(p))
      await writeFile(t.out, await out.save({ useObjectStreams: true }))
      return null
    }
    case 'splitAll': {
      const src = await load(t.path)
      const n = src.getPageCount()
      for (let i = 0; i < n && i < t.outs.length; i++) {
        const out = await PDFDocument.create()
        const [p] = await out.copyPages(src, [i])
        out.addPage(p)
        await writeFile(t.outs[i], await out.save({ useObjectStreams: true }))
        post({ type: 'progress', fraction: (i + 1) / n })
      }
      return n
    }
    case 'resave': {
      const doc = await load(t.path)
      await writeFile(t.out, await doc.save({ useObjectStreams: true }))
      return null
    }
  }
}

parentPort!.on('message', async (t: WorkerTask) => {
  try {
    post({ type: 'done', result: await handle(t) })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    post({ type: 'error', message, encrypted: /encrypt/i.test(message) })
  }
})
