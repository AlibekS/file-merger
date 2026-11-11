// Сетка миниатюр страниц (pdf.js). Файл читается частями через Range-запросы,
// поэтому даже гигабайтный документ открывается мгновенно; миниатюры рисуются
// лениво — только для видимых страниц.

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Icon } from '../icons'
import type { Item } from '../useFiles'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

class RangeTransport extends pdfjs.PDFDataRangeTransport {
  constructor(
    private url: string,
    length: number
  ) {
    super(length, new Uint8Array(0))
  }
  requestDataRange(begin: number, end: number): void {
    fetch(this.url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
      .then((r) => r.arrayBuffer())
      .then((buf) => this.onDataRange(begin, new Uint8Array(buf)))
      .catch(() => undefined)
  }
}

type Doc = pdfjs.PDFDocumentProxy

const THUMB_W = 150

export function Thumbs({
  item,
  selected,
  onChange
}: {
  item: Item
  selected: Set<number>
  onChange: (pages: Set<number>) => void
}) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aspect, setAspect] = useState(1.414)
  const [urls, setUrls] = useState<Record<number, string>>({})
  const queue = useRef<number[]>([])
  // Занятость отслеживается для конкретного документа: при смене файла старый
  // цикл отрисовки может «зависнуть» на уничтоженном документе.
  const busy = useRef<Doc | null>(null)
  const docRef = useRef<Doc | null>(null)
  docRef.current = doc
  const requested = useRef(new Set<number>())
  const lastClicked = useRef<number | null>(null)
  // blob-URL готовых миниатюр: храним в ref, чтобы освободить именно то, что было создано.
  const urlsRef = useRef<Record<number, string>>({})
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setError(null)
    setUrls({})
    requested.current = new Set()
    queue.current = []
    const task = pdfjs.getDocument({
      range: new RangeTransport(window.pdf.fileUrl(item.path), item.size),
      password: item.password,
      disableAutoFetch: true,
      disableStream: true,
      rangeChunkSize: 512 * 1024
    })
    task.onPassword = () => {
      if (!cancelled) setError('Требуется пароль — введите его в списке файлов')
      void task.destroy()
    }
    task.promise.then(
      async (d) => {
        if (cancelled) return
        const p1 = await d.getPage(1)
        const vp = p1.getViewport({ scale: 1 })
        setAspect(vp.height / vp.width)
        setDoc(d)
      },
      (e: Error) => {
        if (!cancelled) setError(`Не удалось открыть: ${e.message}`)
      }
    )
    return () => {
      cancelled = true
      void task.destroy()
      // смена файла или размонтирование — освобождаем все созданные миниатюры
      for (const u of Object.values(urlsRef.current)) URL.revokeObjectURL(u)
      urlsRef.current = {}
    }
  }, [item.path, item.size, item.password])

  const pump = useCallback(async (d: Doc) => {
    if (busy.current === d) return
    busy.current = d
    try {
      while (queue.current.length && docRef.current === d) {
        const n = queue.current.shift()!
        try {
          const page = await d.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const scale = (THUMB_W * Math.min(2, window.devicePixelRatio || 1)) / base.width
          const vp = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(vp.width)
          canvas.height = Math.ceil(vp.height)
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = '#fff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          await page.render({ canvasContext: ctx, viewport: vp }).promise
          page.cleanup()
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
          if (blob && docRef.current === d) {
            const url = URL.createObjectURL(blob)
            urlsRef.current[n] = url
            setUrls((u) => ({ ...u, [n]: url }))
          }
        } catch (e) {
          // страница не отрисовалась — оставляем заглушку
          console.warn('thumbnail', n, e)
        }
      }
    } finally {
      if (busy.current === d) busy.current = null
    }
  }, [])

  const request = useCallback(
    (n: number) => {
      const d = docRef.current
      if (!d || requested.current.has(n)) return
      requested.current.add(n)
      queue.current.push(n)
      void pump(d)
    },
    [pump]
  )

  // Один наблюдатель на всю сетку: карточка, попавшая в зону видимости, запрашивает миниатюру.
  const ioRef = useRef<IntersectionObserver | null>(null)
  if (!ioRef.current) {
    ioRef.current = new IntersectionObserver(
      (entries, io) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          io.unobserve(e.target)
          request(Number((e.target as HTMLElement).dataset.page))
        }
      },
      { rootMargin: '300px' }
    )
  }
  const io = ioRef.current
  useEffect(() => () => io.disconnect(), [io])

  const pages = item.info?.pages ?? doc?.numPages ?? 0

  const toggle = useCallback((n: number, shift: boolean) => {
    const selected = selectedRef.current
    const next = new Set(selected)
    if (shift && lastClicked.current !== null) {
      const [a, b] = [Math.min(lastClicked.current, n), Math.max(lastClicked.current, n)]
      const on = !selected.has(n)
      for (let p = a; p <= b; p++) on ? next.add(p) : next.delete(p)
    } else if (next.has(n)) next.delete(n)
    else next.add(n)
    lastClicked.current = n
    onChangeRef.current(next)
  }, [])

  return (
    <div className="thumbs-wrap">
      <div className="thumbs-tools">
        <span className="name">{item.name}</span>
        <span style={{ color: 'var(--text-2)' }}>
          Выбрано: {selected.size} из {pages}
        </span>
        <button className="btn sm" onClick={() => onChange(new Set(Array.from({ length: pages }, (_, i) => i + 1)))}>
          Все
        </button>
        <button className="btn sm" onClick={() => onChange(new Set(Array.from({ length: pages }, (_, i) => i + 1).filter((p) => p % 2 === 1)))}>
          Нечётные
        </button>
        <button className="btn sm" onClick={() => onChange(new Set(Array.from({ length: pages }, (_, i) => i + 1).filter((p) => p % 2 === 0)))}>
          Чётные
        </button>
        <button className="btn sm ghost" onClick={() => onChange(new Set())}>
          Сбросить
        </button>
      </div>
      {error ? (
        <div className="empty">
          <Icon.Lock width={40} height={40} />
          <p>{error}</p>
        </div>
      ) : !doc ? (
        <div className="empty">
          <span className="spinner" />
          <p>Открываем документ…</p>
        </div>
      ) : (
        <div className="thumbs">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <Thumb key={n} n={n} aspect={aspect} url={urls[n]} on={selected.has(n)} io={io} onToggle={toggle} />
          ))}
        </div>
      )}
    </div>
  )
}

const Thumb = memo(function Thumb({
  n,
  aspect,
  url,
  on,
  io,
  onToggle
}: {
  n: number
  aspect: number
  url?: string
  on: boolean
  io: IntersectionObserver
  onToggle: (n: number, shift: boolean) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (url) return
    const el = ref.current
    if (!el) return
    io.observe(el)
    return () => io.unobserve(el)
  }, [url, io])

  return (
    <button ref={ref} className="thumb" data-page={n} aria-pressed={on} onClick={(e) => onToggle(n, e.shiftKey)} title={`Страница ${n}`}>
      <div className="paper" style={{ aspectRatio: `1 / ${aspect}` }}>
        {url ? <img src={url} alt="" draggable={false} /> : <div className="ph"><span className="spinner" /></div>}
        <span className="tick">
          <Icon.Check />
        </span>
      </div>
      {n}
    </button>
  )
})
