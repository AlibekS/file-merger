// Виртуализированный список файлов: тысячи строк без потери плавности.
// Опционально — сортировка перетаскиванием строк.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Item } from '../useFiles'

const ROW_H = 64
const OVERSCAN = 6
const ROW_MIME = 'application/x-pdfstudio-row'

interface Props {
  items: Item[]
  renderRow: (item: Item, index: number) => ReactNode
  reorder?: (from: number, to: number) => void
  activeId?: string | null
  onActivate?: (id: string) => void
  className?: string
}

export function FileList({ items, renderRow, reorder, activeId, onActivate, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(400)
  const [drag, setDrag] = useState<{ from: number; over: number; after: boolean } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  // При добавлении файлов прокручиваем к концу, если пользователь уже был внизу.
  const prevLen = useRef(items.length)
  useEffect(() => {
    const el = ref.current
    if (el && items.length > prevLen.current && prevLen.current > 0) {
      const nearBottom = el.scrollTop + el.clientHeight >= prevLen.current * ROW_H - ROW_H
      if (nearBottom) el.scrollTop = el.scrollHeight
    }
    prevLen.current = items.length
  }, [items.length])

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(items.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN)
  const visible = items.slice(first, last)

  return (
    <div className={`vlist ${className ?? ''}`} ref={ref} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div className="vlist-inner" style={{ height: items.length * ROW_H }}>
        {visible.map((item, k) => {
          const index = first + k
          const cls = [
            'row',
            item.id === activeId ? 'active' : '',
            drag && drag.from === index ? 'dragging' : '',
            drag && drag.over === index && drag.from !== index ? (drag.after ? 'drop-after' : 'drop-before') : ''
          ].join(' ')
          return (
            <div
              key={item.id}
              className={cls}
              style={{ transform: `translateY(${index * ROW_H}px)` }}
              onClick={onActivate ? () => onActivate(item.id) : undefined}
              draggable={!!reorder}
              onDragStart={
                reorder
                  ? (e) => {
                      e.dataTransfer.setData(ROW_MIME, String(index))
                      e.dataTransfer.effectAllowed = 'move'
                      setDrag({ from: index, over: index, after: false })
                    }
                  : undefined
              }
              onDragOver={
                reorder
                  ? (e) => {
                      if (!e.dataTransfer.types.includes(ROW_MIME)) return
                      e.preventDefault()
                      e.stopPropagation()
                      const r = e.currentTarget.getBoundingClientRect()
                      const after = e.clientY > r.top + r.height / 2
                      setDrag((d) => (d && (d.over !== index || d.after !== after) ? { ...d, over: index, after } : d))
                    }
                  : undefined
              }
              onDrop={
                reorder
                  ? (e) => {
                      if (!e.dataTransfer.types.includes(ROW_MIME) || !drag) return
                      e.preventDefault()
                      e.stopPropagation()
                      let to = drag.over + (drag.after ? 1 : 0)
                      if (to > drag.from) to--
                      if (to !== drag.from) reorder(drag.from, to)
                      setDrag(null)
                    }
                  : undefined
              }
              onDragEnd={reorder ? () => setDrag(null) : undefined}
            >
              {renderRow(item, index)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { ROW_MIME }
