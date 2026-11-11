import { useCallback, useEffect, useMemo, useRef } from 'react'
import { CompressIcon } from '../icons'
import { useFiles, isRunnable, type Item } from '../useFiles'
import { useJob } from '../useJob'
import { FileList } from '../components/FileList'
import {
  DropOverlay,
  EmptyState,
  FileIco,
  FilesToolbar,
  MissingEngineBanner,
  OutputPicker,
  ProgressFooter,
  RowActions,
  StatusCell,
  WorkspaceHead,
  pagesLabel,
  useWindowDrop
} from '../components/common'
import { estimateCompressed, formatBytes, savingsPercent } from '../../../shared/estimate'
import type { CompressPreset, OutputTarget, ToolsInfo } from '../../../shared/types'
import { usePersistent } from '../persist'

const SAMPLE_LIMIT = 400

const PRESETS: { id: CompressPreset; title: string; desc: string }[] = [
  { id: 'light', title: 'Лёгкая', desc: 'Максимальное качество. Оптимизация структуры, без потерь — для печати и архива.' },
  { id: 'medium', title: 'Средняя', desc: 'Баланс. Изображения 150 DPI, JPEG ~78% — для почты и экрана.' },
  { id: 'ultra', title: 'Ультра', desc: 'Минимальный вес. 90 DPI, JPEG ~50%, очистка метаданных — для тяжёлых сканов.' }
]

export function CompressView({ onBack, tools }: { onBack: () => void; tools: ToolsInfo | null }) {
  const files = useFiles()
  const job = useJob(files)
  const [preset, setPreset] = usePersistent<CompressPreset>('compress.preset', 'medium')
  const [output, setOutput] = usePersistent<OutputTarget>('compress.output', { mode: 'source' })

  const add = useCallback((paths: string[]) => void files.addPaths(paths), [files.addPaths])
  const dragging = useWindowDrop(add, !job.running)
  const pick = async () => add(await window.pdf.pickFiles())

  // Пробное сжатие 1–2 страниц в фоне уточняет прогноз (первые SAMPLE_LIMIT файлов);
  // для остальных эвристика корректируется средней поправкой по уже измеренным.
  const sampled = useRef(new Set<string>())
  useEffect(() => {
    // Лимит считается по файлам, которые сейчас в списке: удалённые освобождают место.
    for (const id of sampled.current) if (!files.items[id]) sampled.current.delete(id)
    if (!tools?.ghostscript || !tools.qpdf) return
    const batch = []
    for (const it of files.list) {
      if (sampled.current.size >= SAMPLE_LIMIT) break
      if (sampled.current.has(it.id) || it.status !== 'ready' || !it.info?.pages) continue
      sampled.current.add(it.id)
      batch.push({ id: it.id, path: it.path, password: it.password, pages: it.info.pages })
    }
    if (batch.length) void window.pdf.sample(batch)
  }, [files.list, files.items, tools])

  const correction = useMemo(() => {
    const acc: Record<CompressPreset, number[]> = { light: [], medium: [], ultra: [] }
    for (const it of files.list) {
      if (!it.ratios || !it.info?.stats) continue
      for (const p of PRESETS) {
        const h = estimateCompressed(it.info.stats, p.id) / it.size
        if (h > 0) acc[p.id].push(it.ratios[p.id] / h)
      }
    }
    const avg = (xs: number[]) => (xs.length ? Math.min(3, Math.max(0.2, xs.reduce((a, b) => a + b, 0) / xs.length)) : 1)
    return { light: avg(acc.light), medium: avg(acc.medium), ultra: avg(acc.ultra) }
  }, [files.list])

  const estimateFor = useCallback(
    (it: Item, p: CompressPreset) => {
      if (it.ratios) return Math.round(it.size * Math.min(1, it.ratios[p]))
      if (!it.info?.stats) return null
      return Math.min(it.size, Math.round(estimateCompressed(it.info.stats, p) * correction[p]))
    },
    [correction]
  )

  const totals = useMemo(() => {
    const res = { before: 0, after: 0, actualBefore: 0, actualAfter: 0, byPreset: { light: 0, medium: 0, ultra: 0 } as Record<CompressPreset, number>, known: 0 }
    for (const it of files.list) {
      if (it.status === 'skipped' || it.info?.error) continue
      res.before += it.size
      for (const p of PRESETS) res.byPreset[p.id] += estimateFor(it, p.id) ?? it.size
      if (it.info?.stats) res.known++
      if ((it.status === 'done' || it.status === 'optimal') && it.outputSize !== undefined) {
        res.actualBefore += it.size
        res.actualAfter += it.outputSize
      }
    }
    res.after = res.byPreset[preset]
    return res
  }, [files.list, preset, estimateFor])

  const runnable = files.list.filter(isRunnable)
  const needsGs = preset !== 'light' && tools && !tools.ghostscript
  // Пока идёт анализ, запуск закрыт: иначе ещё не проверенные файлы молча не попали бы в задание.
  const analysing = files.list.some((f) => f.status === 'pending')
  const canStart = runnable.length > 0 && !analysing && !job.running && !needsGs && (output.mode === 'source' || !!output.dir)

  const start = () =>
    job.start({
      kind: 'compress',
      preset,
      output,
      files: runnable.map((f) => ({ id: f.id, path: f.path, name: f.name, size: f.size, password: f.password, pages: f.info?.pages }))
    })

  const renderRow = (it: Item) => {
    const est = estimateFor(it, preset)
    const finished = (it.status === 'done' || it.status === 'optimal') && it.outputSize !== undefined
    const after = finished ? it.outputSize! : est
    const pct = after !== null ? savingsPercent(it.size, after) : null
    return (
      <>
        <FileIco item={it} />
        <div className="meta">
          <div className="name" title={it.path}>
            {it.name}
          </div>
          <div className={`sub ${it.status === 'error' || it.info?.passwordOk === false ? 'err' : ''}`} title={it.message ?? it.path}>
            {it.message ?? [pagesLabel(it), it.path].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="right">
          <div className="size-cell">
            <span>{formatBytes(it.size)}</span>
            {after !== null && it.status !== 'error' && it.status !== 'skipped' && (
              <>
                <span className="arrow">→</span>
                <span className="after">
                  {finished ? '' : '~'}
                  {formatBytes(after)}
                </span>{' '}
                <span className={`badge ${pct ? 'save' : ''}`}>-{pct}%</span>
              </>
            )}
          </div>
          <StatusCell item={it} files={files} running={job.running} />
          <RowActions item={it} files={files} running={job.running} />
        </div>
      </>
    )
  }

  const empty = files.list.length === 0

  return (
    <div className="workspace">
      <WorkspaceHead title="Сжать PDF" icon={<CompressIcon />} onBack={onBack} busy={job.running} />
      {tools && !tools.ghostscript && (
        <MissingEngineBanner text="Ghostscript не найден: доступен только режим «Лёгкая». Для режимов «Средняя» и «Ультра» установите Ghostscript (см. README) и перезапустите приложение." />
      )}

      <section className="files-panel surface">
        {empty ? (
          <EmptyState icon={<CompressIcon />} onPick={pick} />
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
          <h3>Степень сжатия</h3>
          <div className="presets" role="radiogroup">
            {PRESETS.map((p) => {
              const pct = totals.before ? savingsPercent(totals.before, totals.byPreset[p.id]) : null
              return (
                <button
                  key={p.id}
                  className="preset"
                  role="radio"
                  aria-checked={preset === p.id}
                  onClick={() => setPreset(p.id)}
                  disabled={job.running}
                >
                  <span className="radio" />
                  <b>{p.title}</b>
                  <span className="pct">{pct !== null && totals.known ? `~ -${pct}%` : ''}</span>
                  <span className="desc">{p.desc}</span>
                </button>
              )
            })}
          </div>
        </div>


        <OutputPicker value={output} onChange={setOutput} suffix="_compressed" disabled={job.running} />

        </div>
        <div className="panel surface action">
          <h3>Итого</h3>
          <dl className="totals">
            <dt>Исходный размер</dt>
            <dd>{formatBytes(totals.before)}</dd>
            <dt>Прогноз после сжатия</dt>
            <dd>
              ~{formatBytes(totals.after)}{' '}
              <span className="accent">-{savingsPercent(totals.before, totals.after)}%</span>
            </dd>
            {totals.actualBefore > 0 && (
              <>
                <dt>Фактически</dt>
                <dd>
                  {formatBytes(totals.actualBefore)} → {formatBytes(totals.actualAfter)}{' '}
                  <span className="accent">-{savingsPercent(totals.actualBefore, totals.actualAfter)}%</span>
                </dd>
              </>
            )}
          </dl>
          <button className="btn primary green big" disabled={!canStart} onClick={start}>
            <CompressIcon width={18} height={18} /> Сжать PDF
            {runnable.length > 1 ? ` (${runnable.length.toLocaleString('ru-RU')})` : ''}
          </button>
          {needsGs && <p className="hint err">Для этого режима нужен Ghostscript.</p>}
          {analysing && !job.running && <p className="hint">Идёт анализ файлов…</p>}
        </div>
      </aside>

      <ProgressFooter
        progress={job.progress}
        running={job.running}
        onCancel={job.cancel}
        onDismiss={job.dismiss}
        doneText={
          totals.actualBefore > 0
            ? `${formatBytes(totals.actualBefore)} → ${formatBytes(totals.actualAfter)} (-${savingsPercent(totals.actualBefore, totals.actualAfter)}%)`
            : undefined
        }
      />
      {dragging && <DropOverlay />}
    </div>
  )
}
