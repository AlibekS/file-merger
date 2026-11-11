// Состояние списка файлов инструмента: добавление, анализ, пароли, порядок, прогресс.

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import type { CompressPreset, FileEntry, FileInfo, FileProgress, FileStatus } from '../../shared/types'

export interface Item extends FileEntry {
  info?: FileInfo
  status: FileStatus
  password?: string
  message?: string
  fraction?: number
  outputSize?: number
  outputPath?: string
  outputCount?: number
  /** Коэффициенты «после/до» по пробному сжатию (null — пробное сжатие невозможно). */
  ratios?: Record<CompressPreset, number> | null
}

interface State {
  order: string[]
  items: Record<string, Item>
}

type Action =
  | { type: 'add'; entries: FileEntry[] }
  | { type: 'remove'; id: string }
  | { type: 'clear' }
  | { type: 'move'; from: number; to: number }
  | { type: 'setOrder'; order: string[] }
  | { type: 'info'; infos: FileInfo[] }
  | { type: 'progress'; list: FileProgress[] }
  | { type: 'patch'; id: string; patch: Partial<Item> }
  | { type: 'cancelQueued' }
  | { type: 'ratios'; list: { id: string; ratios: Record<CompressPreset, number> | null }[] }
  | { type: 'resetForRun'; ids: string[] }

function statusFromInfo(info: FileInfo): FileStatus {
  if (info.error) return 'error'
  if (info.needsPassword && !info.passwordOk) return 'locked'
  return 'ready'
}

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'add': {
      const known = new Set(state.order.map((id) => state.items[id].path))
      const items = { ...state.items }
      const order = [...state.order]
      for (const e of a.entries) {
        if (known.has(e.path)) continue
        known.add(e.path)
        items[e.id] = { ...e, status: 'pending' }
        order.push(e.id)
      }
      return { order, items }
    }
    case 'remove': {
      const items = { ...state.items }
      delete items[a.id]
      return { order: state.order.filter((id) => id !== a.id), items }
    }
    case 'clear':
      return { order: [], items: {} }
    case 'move': {
      const order = [...state.order]
      const [x] = order.splice(a.from, 1)
      order.splice(a.to, 0, x)
      return { ...state, order }
    }
    case 'ratios': {
      const items = { ...state.items }
      for (const r of a.list) if (items[r.id]) items[r.id] = { ...items[r.id], ratios: r.ratios }
      return { ...state, items }
    }
    case 'setOrder':
      return { ...state, order: a.order }
    case 'info': {
      let items: Record<string, Item> | null = null
      for (const info of a.infos) {
        const it = state.items[info.id]
        if (!it) continue
        items ??= { ...state.items }
        const status = statusFromInfo(info)
        items[info.id] = {
          ...it,
          info,
          status,
          message:
            info.error ??
            (info.passwordOk === false ? 'Неверный пароль' : info.needsPassword && !info.passwordOk ? 'Защищён паролем' : undefined)
        }
      }
      return items ? { ...state, items } : state
    }
    case 'progress': {
      let items: Record<string, Item> | null = null
      for (const p of a.list) {
        const it = state.items[p.fileId]
        if (!it) continue
        items ??= { ...state.items }
        items[p.fileId] = {
          ...it,
          status: p.status,
          fraction: p.fraction ?? it.fraction,
          outputSize: p.outputSize ?? it.outputSize,
          outputPath: p.outputPath ?? it.outputPath,
          outputCount: p.outputCount ?? it.outputCount,
          message: p.message
        }
      }
      return items ? { ...state, items } : state
    }
    case 'patch': {
      const it = state.items[a.id]
      if (!it) return state
      return { ...state, items: { ...state.items, [a.id]: { ...it, ...a.patch } } }
    }
    case 'cancelQueued': {
      const items = { ...state.items }
      for (const id of state.order) {
        if (items[id].status === 'queued' || items[id].status === 'processing')
          items[id] = { ...items[id], status: 'cancelled', message: 'Отменено' }
      }
      return { ...state, items }
    }
    case 'resetForRun': {
      const items = { ...state.items }
      for (const id of a.ids)
        items[id] = { ...items[id], status: 'queued', fraction: 0, message: undefined, outputPath: undefined, outputSize: undefined }
      return { ...state, items }
    }
  }
}

export function useFiles() {
  const [state, dispatch] = useReducer(reducer, { order: [], items: {} })
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const offInfo = window.pdf.onInfo((infos) => dispatch({ type: 'info', infos }))
    const offProg = window.pdf.onFileProgress((list) => dispatch({ type: 'progress', list }))
    const offRatios = window.pdf.onRatios((list) => dispatch({ type: 'ratios', list }))
    return () => {
      offRatios()
      offInfo()
      offProg()
    }
  }, [])

  const addPaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return 0
    const entries = await window.pdf.resolvePaths(paths)
    const known = new Set(stateRef.current.order.map((id) => stateRef.current.items[id].path))
    const fresh = entries.filter((e) => !known.has(e.path))
    dispatch({ type: 'add', entries: fresh })
    if (fresh.length) void window.pdf.inspect(fresh.map((e) => ({ id: e.id, path: e.path })))
    return fresh.length
  }, [])

  const setPassword = useCallback((id: string, password: string) => {
    const it = stateRef.current.items[id]
    if (!it) return
    dispatch({ type: 'patch', id, patch: { password, status: 'pending', message: 'Проверка пароля…' } })
    void window.pdf.inspect([{ id, path: it.path, password }])
  }, [])

  const list = useMemo(() => state.order.map((id) => state.items[id]), [state])

  return {
    list,
    items: state.items,
    order: state.order,
    addPaths,
    setPassword,
    remove: useCallback((id: string) => dispatch({ type: 'remove', id }), []),
    clear: useCallback(() => dispatch({ type: 'clear' }), []),
    move: useCallback((from: number, to: number) => dispatch({ type: 'move', from, to }), []),
    setOrder: useCallback((order: string[]) => dispatch({ type: 'setOrder', order }), []),
    skip: useCallback(
      (id: string) => dispatch({ type: 'patch', id, patch: { status: 'skipped', message: 'Пропущен' } }),
      []
    ),
    cancelQueued: useCallback(() => dispatch({ type: 'cancelQueued' }), []),
    resetForRun: useCallback((ids: string[]) => dispatch({ type: 'resetForRun', ids }), [])
  }
}

export type FilesApi = ReturnType<typeof useFiles>

/** Файл можно отправлять в обработку. */
export function isRunnable(it: Item): boolean {
  return ['ready', 'done', 'optimal', 'cancelled', 'queued'].includes(it.status) || (it.status === 'error' && !it.info?.error)
}
