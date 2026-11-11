import { useEffect, useState, type ReactNode } from 'react'
import { Icon, PdfFileIcon } from '../icons'
import type { FilesApi, Item } from '../useFiles'
import type { JobProgress, OutputTarget } from '../../../shared/types'
import { formatBytes } from '../../../shared/estimate'

/** Перетаскивание файлов и папок на всё окно. */
export function useWindowDrop(onPaths: (paths: string[]) => void, enabled: boolean): boolean {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      if (enabled) setOver(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const overH = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = enabled ? 'copy' : 'none'
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setOver(false)
      if (!enabled || !e.dataTransfer) return
      const paths = [...e.dataTransfer.files].map((f) => window.pdf.getPathForFile(f)).filter(Boolean)
      onPaths(paths)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overH)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overH)
      window.removeEventListener('drop', drop)
    }
  }, [onPaths, enabled])
  return over
}

export function DropOverlay() {
  return (
    <div className="drop-overlay">
      <div>
        Отпустите, чтобы добавить
        <small>PDF файлы или целые папки — все PDF внутри будут найдены</small>
      </div>
    </div>
  )
}

export function EmptyState({ icon, onPick, multiple = true }: { icon: ReactNode; onPick: () => void; multiple?: boolean }) {
  return (
    <div className="empty">
      <div className="big-ico">{icon}</div>
      <h3>Перетащите PDF {multiple ? 'файлы' : 'файл'} сюда</h3>
      <p>Или выберите их в проводнике. Можно перетащить папку — все PDF внутри будут добавлены. Ограничений по числу и размеру нет.</p>
      <button className="btn primary" onClick={onPick}>
        <Icon.Folder /> Выбрать PDF файлы
      </button>
    </div>
  )
}

export function FilesToolbar({
  files,
  onAdd,
  disabled,
  extra
}: {
  files: FilesApi
  onAdd: () => void
  disabled?: boolean
  extra?: ReactNode
}) {
  const total = files.list.reduce((s, f) => s + f.size, 0)
  const analysing = files.list.filter((f) => f.status === 'pending').length
  return (
    <div className="files-toolbar">
      <div className="count">
        {files.list.length.toLocaleString('ru-RU')} {plural(files.list.length, 'файл', 'файла', 'файлов')}
        <small>
          {formatBytes(total)}
          {analysing > 0 && ` · анализ ${analysing.toLocaleString('ru-RU')}…`}
        </small>
      </div>
      {extra}
      <button className="btn sm" onClick={onAdd} disabled={disabled}>
        <Icon.Plus /> Добавить ещё файлы
      </button>
      <button className="btn sm ghost" onClick={files.clear} disabled={disabled} title="Очистить список">
        <Icon.Trash />
      </button>
    </div>
  )
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export function FileIco({ item }: { item: Item }) {
  const s = item.status === 'error' ? 'err' : item.status === 'locked' ? 'lock' : 'ok'
  return (
    <div className="file-ico">
      <PdfFileIcon status={s} />
    </div>
  )
}

export function pagesLabel(item: Item): string {
  const p = item.info?.pages
  if (item.status === 'pending' && !item.info) return 'анализ…'
  if (!p) return ''
  return `${p.toLocaleString('ru-RU')} ${plural(p, 'страница', 'страницы', 'страниц')}`
}

/** Правая часть строки: статус обработки, пароль, ошибки. */
export function StatusCell({ item, files, running }: { item: Item; files: FilesApi; running: boolean }) {
  const [pw, setPw] = useState('')
  if (item.status === 'locked' && !running) {
    return (
      <form
        className="pw-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (pw) files.setPassword(item.id, pw)
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className={`input small ${item.info?.passwordOk === false ? 'invalid' : ''}`}
          type="password"
          placeholder="Пароль"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus={false}
        />
        <button className="btn sm" type="submit" disabled={!pw}>
          Открыть
        </button>
        <button className="btn sm ghost" type="button" onClick={() => files.skip(item.id)}>
          Пропустить
        </button>
      </form>
    )
  }
  switch (item.status) {
    case 'pending':
      return <span className="spinner" title="Анализ" />
    case 'queued':
      return <span className="badge">В очереди</span>
    case 'processing':
      return (
        <div className="mini-progress" title="Обработка">
          <i style={{ width: `${Math.max(4, (item.fraction ?? 0) * 100)}%` }} />
        </div>
      )
    case 'done':
      return (
        <span className="badge save">
          <Icon.Check /> Готово
        </span>
      )
    case 'optimal':
      return <span className="badge warn">Уже оптимален</span>
    case 'error':
      return (
        <span className="badge err" title={item.message}>
          <Icon.Alert /> Ошибка
        </span>
      )
    case 'locked':
      return (
        <span className="badge warn">
          <Icon.Lock /> Пароль
        </span>
      )
    case 'skipped':
      return <span className="badge">Пропущен</span>
    case 'cancelled':
      return <span className="badge">Отменён</span>
    default:
      return null
  }
}

export function RowActions({
  item,
  files,
  running,
  children
}: {
  item: Item
  files: FilesApi
  running: boolean
  children?: ReactNode
}) {
  return (
    <>
      {children}
      {item.outputPath && (
        <button
          className="icon-btn"
          title="Показать в папке"
          onClick={(e) => {
            e.stopPropagation()
            void window.pdf.showInFolder(item.outputPath!)
          }}
        >
          <Icon.Folder />
        </button>
      )}
      <button
        className="icon-btn"
        title="Убрать из списка"
        disabled={running}
        onClick={(e) => {
          e.stopPropagation()
          files.remove(item.id)
        }}
      >
        <Icon.X />
      </button>
    </>
  )
}

export function OutputPicker({
  value,
  onChange,
  suffix,
  sourceHint,
  disabled
}: {
  value: OutputTarget
  onChange: (v: OutputTarget) => void
  suffix: string
  sourceHint?: string
  disabled?: boolean
}) {
  const pick = async () => {
    const dir = await window.pdf.pickFolder()
    if (dir) onChange({ mode: 'folder', dir })
  }
  return (
    <div className="panel surface">
      <h3>Куда сохранить</h3>
      <div className="radio-list" role="radiogroup">
        <button
          className="radio-item"
          role="radio"
          aria-checked={value.mode === 'source'}
          disabled={disabled}
          onClick={() => onChange({ ...value, mode: 'source' })}
        >
          <span className="radio" />
          <span>
            <b>В исходную папку</b>
            <small>{sourceHint ?? `Рядом с оригиналами, с суффиксом «${suffix}»`}</small>
          </span>
        </button>
        <button
          className="radio-item"
          role="radio"
          aria-checked={value.mode === 'folder'}
          disabled={disabled}
          onClick={() => (value.dir ? onChange({ ...value, mode: 'folder' }) : void pick())}
        >
          <span className="radio" />
          <span>
            <b>Выбрать папку</b>
            <small>Все результаты в одну папку</small>
          </span>
        </button>
      </div>
      {value.mode === 'folder' && value.dir && (
        <>
          <div className="path-box">{value.dir}</div>
          <button className="btn sm" onClick={pick} disabled={disabled}>
            <Icon.Folder /> Изменить папку
          </button>
        </>
      )}
    </div>
  )
}

export function ProgressFooter({
  progress,
  running,
  onCancel,
  onDismiss,
  doneText
}: {
  progress: JobProgress | null
  running: boolean
  onCancel: () => void
  onDismiss: () => void
  doneText?: ReactNode
}) {
  if (!progress) return null
  const finished = progress.finished
  const pct = Math.round(progress.fraction * 100)
  const openTarget = progress.outputPath ?? progress.outputDir
  return (
    <div className="progress-bar surface">
      <div className="label">
        {finished
          ? progress.cancelled
            ? 'Обработка отменена'
            : 'Готово'
          : `Обработано ${progress.done.toLocaleString('ru-RU')} из ${progress.total.toLocaleString('ru-RU')} ${plural(progress.total, 'файла', 'файлов', 'файлов')}`}
        <small>{finished ? doneText : `${pct}%`}</small>
      </div>
      <div className={`track-lg ${finished ? 'done' : ''}`}>
        <i style={{ width: `${finished ? 100 : Math.max(2, pct)}%` }} />
      </div>
      {running && (
        <button className="btn danger" onClick={onCancel}>
          <Icon.X /> Отменить
        </button>
      )}
      {finished && openTarget && (
        <button
          className="btn"
          onClick={() =>
            progress.outputPath ? window.pdf.showInFolder(progress.outputPath) : window.pdf.openPath(progress.outputDir!)
          }
        >
          <Icon.Folder /> Открыть папку
        </button>
      )}
      {finished && (
        <button className="icon-btn" onClick={onDismiss} title="Скрыть">
          <Icon.X />
        </button>
      )}
    </div>
  )
}

export function WorkspaceHead({ title, icon, onBack, children }: { title: string; icon: ReactNode; onBack: () => void; children?: ReactNode }) {
  return (
    <div className="ws-head">
      <button className="btn ghost" onClick={onBack}>
        <Icon.Back /> Назад
      </button>
      <h1>
        {icon}
        {title}
      </h1>
      <div className="spacer" />
      {children}
    </div>
  )
}

export function MissingEngineBanner({ text }: { text: string }) {
  return (
    <div className="banner">
      <Icon.Alert />
      <span>{text}</span>
    </div>
  )
}
