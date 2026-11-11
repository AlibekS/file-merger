import { useCallback, useState } from 'react'

/** Небольшие пользовательские настройки в localStorage (с защитой от недоступного хранилища). */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`pdfstudio.${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`pdfstudio.${key}`, JSON.stringify(value))
  } catch {
    /* хранилище недоступно — не критично */
  }
}

export function usePersistent<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => load(key, fallback))
  const set = useCallback(
    (nv: T) => {
      setV(nv)
      save(key, nv)
    },
    [key]
  )
  return [v, set]
}
