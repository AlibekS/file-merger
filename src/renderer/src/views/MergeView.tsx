import { useCallback, useState } from 'react'
import { Icon, MergeIcon } from '../icons'
import { useFiles, type Item } from '../useFiles'
import { useJob } from '../useJob'
import { FileList } from '../components/FileList'
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
import type { OutputTarget } from '../../../shared/types'
import { usePersistent } from '../persist'

export function MergeView({ onBack }: { onBack: () => void }) {
  const files = useFiles()
  const job = useJob(files)
  const [output, setOutput] = usePersistent<OutputTarget>('merge.output', { mode: 'source' })
  const [fileName, setFileName] = useState('merged_document.pdf')

  const add = useCallback((paths: string[]) => void files.addPaths(paths), [files.addPaths])
  const dragging = useWindowDrop(add, !job.running)
  const pick = async () => add(await window.pdf.pickFiles())

  const active = files.list.filter((f) => f.status !== 'skipped')
  const pending = active.some((f) => f.status === 'pending')
  const locked = active.filter((f) => f.status === 'locked')
  const broken = active.filter((f) => f.info?.error)
  const totalPages = active.reduce((s, f) => s + (f.info?.pages ?? 0), 0)
  const totalSize = active.reduce((s, f) => s + f.size, 0)

  let blocker: string | null = null
  if (active.length < 2) blocker = 'Добавьте минимум два PDF файла'
  else if (pending) blocker = 'Идёт анализ файлов…'
  else if (locked.length) blocker = `Введите пароль или пропустите: ${locked.length} ${plural(locked.length, 'файл', 'файла', 'файлов')}`
  else if (broken.length) blocker = `Удалите повреждённые файлы (${broken.length})`
  else if (output.mode === 'folder' && !output.dir) blocker = 'Выберите папку для сохранения'

  const start = () =>
    job.start({
      kind: 'merge',
      fileName,
      output,
      files: active.map((f) => ({ id: f.id, path: f.path, name: f.name, size: f.size, password: f.password, pages: f.info?.pages }))
    })

  const renderRow = (it: Item, index: number) => (
    <>
      <span className="grip" title="Перетащите, чтобы изменить порядок">
        <Icon.Grip />
      </span>
      <span className="index">{index + 1}</span>
      <FileIco item={it} />
      <div className="meta">
        <div className="name" title={it.path}>
          {it.name}
        </div>
        <div className={`sub ${it.status === 'error' ? 'err' : ''}`} title={it.message ?? it.path}>
          {it.message ?? [pagesLabel(it), formatBytes(it.size)].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="right">
        <StatusCell item={it} files={files} running={job.running} />
        <RowActions item={it} files={files} running={job.running}>
          <button
            className="icon-btn"
            title="Вверх"
            disabled={job.running || index === 0}
            onClick={(e) => {
              e.stopPropagation()
              files.move(index, index - 1)
            }}
          >
            <Icon.Up />
          </button>
          <button
            className="icon-btn"
            title="Вниз"
            disabled={job.running || index === files.list.length - 1}
            onClick={(e) => {
              e.stopPropagation()
              files.move(index, index + 1)
            }}
          >
            <Icon.Down />
          </button>
        </RowActions>
      </div>
    </>
  )

  const sortByName = () => {
    const sorted = [...files.list].sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }))
    files.setOrder(sorted.map((f) => f.id))
  }

  return (
    <div className="workspace">
      <WorkspaceHead title="Объединить PDF" icon={<MergeIcon />} onBack={onBack} />

      <section className="files-panel surface">
        {files.list.length === 0 ? (
          <EmptyState icon={<MergeIcon />} onPick={pick} />
        ) : (
          <>
            <FilesToolbar
              files={files}
              onAdd={pick}
              disabled={job.running}
              extra={
                <button className="btn sm ghost" onClick={sortByName} disabled={job.running} title="Отсортировать по имени">
                  А→Я
                </button>
              }
            />
            <FileList items={files.list} renderRow={renderRow} reorder={job.running ? undefined : files.move} />
          </>
        )}
      </section>

      <aside className="side">
        <div className="side-scroll">
        <div className="panel surface">
          <h3>Итоговый файл</h3>
          <input
            className="input wide"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            disabled={job.running}
            spellCheck={false}
            aria-label="Имя итогового файла"
          />
          <p className="hint">
            {active.length.toLocaleString('ru-RU')} {plural(active.length, 'файл', 'файла', 'файлов')} ·{' '}
            {totalPages.toLocaleString('ru-RU')} {plural(totalPages, 'страница', 'страницы', 'страниц')} · ~{formatBytes(totalSize)}
          </p>
          <p className="hint">Порядок меняется перетаскиванием строк или кнопками ↑ ↓.</p>
        </div>

        <OutputPicker value={output} onChange={setOutput} suffix="_merged" sourceHint="В папку первого файла, имя — из поля выше" disabled={job.running} />

        </div>
        <div className="panel surface action">
          <button className="btn primary big" disabled={!!blocker || job.running} onClick={start}>
            <MergeIcon width={18} height={18} /> Объединить PDF
          </button>
          {blocker && <p className="hint">{blocker}</p>}
        </div>
      </aside>

      <ProgressFooter
        progress={job.progress}
        running={job.running}
        onCancel={job.cancel}
        onDismiss={job.dismiss}
        doneText={job.progress?.outputSize ? `${job.progress.outputPath?.split(/[\\/]/).pop()} · ${formatBytes(job.progress.outputSize)}` : undefined}
      />
      {dragging && <DropOverlay />}
    </div>
  )
}
