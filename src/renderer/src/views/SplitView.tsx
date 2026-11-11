import { useCallback, useEffect, useMemo, useState } from 'react'
import { SplitIcon } from '../icons'
import { useFiles, isRunnable, type Item } from '../useFiles'
import { useJob } from '../useJob'
import { FileList } from '../components/FileList'
import { Thumbs } from '../components/Thumbs'
import {
  DropOverlay,
  EmptyState,
  FileIco,
  FilesToolbar,
  OutputPicker,
  ProgressFooter,
  RowActions,
  StatusCell,
  WorkspaceHead,
  pagesLabel,
  plural,
  useWindowDrop
} from '../components/common'
import { formatBytes } from '../../../shared/estimate'
import { parseRanges, pagesToRanges, rangeLabel } from '../../../shared/ranges'
import type { OutputTarget, SplitMode } from '../../../shared/types'
import { usePersistent } from '../persist'

const MODES: { id: SplitMode; title: string; desc: string }[] = [
  { id: 'all', title: 'Извлечь все страницы', desc: 'Каждая страница — отдельный PDF: page_001.pdf, page_002.pdf…' },
  { id: 'ranges', title: 'По диапазонам страниц', desc: 'Например: 1-5, 8, 12-20' },
  { id: 'visual', title: 'Визуальный выбор', desc: 'Отметьте нужные страницы на миниатюрах' }
]

export function SplitView({ onBack }: { onBack: () => void }) {
  const files = useFiles()
  const job = useJob(files)
  const [mode, setMode] = usePersistent<SplitMode>('split.mode', 'all')
  const [ranges, setRanges] = useState('')
  const [combine, setCombine] = usePersistent<boolean>('split.combine', false)
  const [output, setOutput] = usePersistent<OutputTarget>('split.output', { mode: 'source' })
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Record<string, Set<number>>>({})

  const add = useCallback((paths: string[]) => void files.addPaths(paths), [files.addPaths])
  const dragging = useWindowDrop(add, !job.running)
  const pick = async () => add(await window.pdf.pickFiles())

  // Активный файл для визуального режима — первый открываемый.
  useEffect(() => {
    if (activeId && files.items[activeId]) return
    const first = files.list.find((f) => f.status === 'ready')
    setActiveId(first?.id ?? null)
  }, [files.list, files.items, activeId])

  const active = activeId ? files.items[activeId] : undefined
  const runnable = files.list.filter(isRunnable)
  const maxPages = Math.max(0, ...runnable.map((f) => f.info?.pages ?? 0))
  const parsed = useMemo(() => (mode === 'ranges' ? parseRanges(ranges) : null), [mode, ranges])
  const selectedTotal = Object.entries(selection).reduce((s, [id, set]) => s + (files.items[id] ? set.size : 0), 0)

  let blocker: string | null = null
  if (!runnable.length) blocker = files.list.length ? 'Нет файлов, готовых к обработке' : 'Добавьте PDF файлы'
  else if (mode === 'ranges' && parsed?.error) blocker = parsed.error
  else if (mode === 'visual' && selectedTotal === 0) blocker = 'Отметьте страницы на миниатюрах'
  else if (output.mode === 'folder' && !output.dir) blocker = 'Выберите папку для сохранения'

  const jobFiles = (mode === 'visual' ? runnable.filter((f) => selection[f.id]?.size) : runnable).map((f) => ({
    id: f.id,
    path: f.path,
    name: f.name,
    size: f.size,
    password: f.password,
    pages: f.info?.pages
  }))

  const start = () =>
    job.start({
      kind: 'split',
      mode,
      ranges,
      combine: mode === 'all' ? false : combine,
      output,
      pagesByFile: mode === 'visual' ? Object.fromEntries(Object.entries(selection).map(([k, v]) => [k, [...v]])) : undefined,
      files: jobFiles
    })

  const renderRow = (it: Item) => {
    const sel = selection[it.id]
    return (
      <>
        <FileIco item={it} />
        <div className="meta">
          <div className="name" title={it.path}>
            {it.name}
          </div>
          <div className={`sub ${it.status === 'error' ? 'err' : ''}`} title={it.message ?? it.path}>
            {it.message ??
              [
                pagesLabel(it),
                formatBytes(it.size),
                mode === 'visual' && sel?.size ? `выбрано: ${pagesToRanges([...sel]).map(rangeLabel).join(', ')}` : '',
                it.outputCount ? `создано файлов: ${it.outputCount}` : ''
              ]
                .filter(Boolean)
                .join(' · ')}
          </div>
        </div>
        <div className="right">
          <StatusCell item={it} files={files} running={job.running} />
          <RowActions item={it} files={files} running={job.running} />
        </div>
      </>
    )
  }

  const outputsHint = (() => {
    if (mode === 'all') return null
    if (mode === 'ranges' && parsed && !parsed.error) {
      const n = parsed.ranges.length
      return combine ? 'Будет создан 1 файл на каждый документ' : `Будет создано до ${n} ${plural(n, 'файла', 'файлов', 'файлов')} на документ`
    }
    return null
  })()

  return (
    <div className="workspace">
      <WorkspaceHead title="Разделить PDF" icon={<SplitIcon />} onBack={onBack} />

      <section className="files-panel surface">
        {files.list.length === 0 ? (
          <EmptyState icon={<SplitIcon />} onPick={pick} />
        ) : mode === 'visual' ? (
          <>
            <FilesToolbar files={files} onAdd={pick} disabled={job.running} />
            <div className="split-body">
              <FileList
                items={files.list}
                renderRow={renderRow}
                activeId={activeId}
                onActivate={(id) => files.items[id]?.status !== 'locked' && setActiveId(id)}
              />
              {active && active.status !== 'pending' && !active.info?.error && active.status !== 'locked' ? (
                <Thumbs
                  item={active}
                  selected={selection[active.id] ?? new Set()}
                  onChange={(s) => setSelection((prev) => ({ ...prev, [active.id]: s }))}
                />
              ) : (
                <div className="empty">
                  <p>{active?.status === 'pending' ? 'Анализ файла…' : 'Выберите файл в списке, чтобы увидеть его страницы'}</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <FilesToolbar files={files} onAdd={pick} disabled={job.running} />
            <FileList items={files.list} renderRow={renderRow} />
          </>
        )}
      </section>

      <aside className="side">
        <div className="side-scroll">
        <div className="panel surface">
          <h3>Способ разделения</h3>
          <div className="radio-list" role="radiogroup">
            {MODES.map((m) => (
              <button
                key={m.id}
                className="radio-item"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => setMode(m.id)}
                disabled={job.running}
              >
                <span className="radio" />
                <span>
                  <b>{m.title}</b>
                  <small>{m.desc}</small>
                </span>
              </button>
            ))}
          </div>
          {mode === 'ranges' && (
            <>
              <input
                className={`input wide ${ranges && parsed?.error ? 'invalid' : ''}`}
                placeholder="1-5, 8, 12-20"
                value={ranges}
                onChange={(e) => setRanges(e.target.value)}
                disabled={job.running}
                spellCheck={false}
                aria-label="Диапазоны страниц"
              />
              {ranges && parsed?.error ? (
                <p className="hint err">{parsed.error}</p>
              ) : (
                <p className="hint">
                  «10-» — с 10-й до конца. {maxPages ? `Страниц в самом длинном файле: ${maxPages}.` : ''}
                </p>
              )}
            </>
          )}
          {mode !== 'all' && (
            <label className="check">
              <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} disabled={job.running} />
              {mode === 'ranges' ? 'Объединить выбранные диапазоны в один PDF' : 'Сохранить выбранные страницы одним PDF'}
            </label>
          )}
          {outputsHint && <p className="hint">{outputsHint}</p>}
        </div>

        <OutputPicker value={output} onChange={setOutput} suffix="_split" disabled={job.running} />

        </div>
        <div className="panel surface action">
          <button className="btn primary big" disabled={!!blocker || job.running} onClick={start}>
            <SplitIcon width={18} height={18} /> Разделить PDF
            {jobFiles.length > 1 ? ` (${jobFiles.length.toLocaleString('ru-RU')})` : ''}
          </button>
          {blocker && <p className="hint">{blocker}</p>}
        </div>
      </aside>

      <ProgressFooter progress={job.progress} running={job.running} onCancel={job.cancel} onDismiss={job.dismiss} />
      {dragging && <DropOverlay />}
    </div>
  )
}
