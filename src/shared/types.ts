// Типы, общие для main-процесса, preload и интерфейса.

export type ToolKind = 'merge' | 'split' | 'compress'
export type CompressPreset = 'light' | 'medium' | 'ultra'
export type OutputMode = 'folder' | 'source'

/** Статистика по одному растровому изображению внутри PDF (для прогноза веса). */
export interface ImageStat {
  /** Ширина и высота в пикселях. */
  w: number
  h: number
  /** Бит на компонент. */
  bpc: number
  /** Количество цветовых компонент (1 — серый/монохром, 3 — RGB, 4 — CMYK). */
  comps: number
  /** Фильтр сжатия: DCT, Flate, JBIG2, CCITT, JPX, other. */
  filter: string
  /** Суммарный размер потоков в байтах (для всех count изображений группы). */
  bytes: number
  /** Сколько изображений с такими параметрами. */
  count: number
}

/** Агрегированная статистика содержимого PDF. */
export interface ContentStats {
  fileSize: number
  /** Суммарный объём потоков изображений. */
  imageBytes: number
  /** Сводка по изображениям (сгруппировано, чтобы не гонять тысячи записей через IPC). */
  images: ImageStat[]
  /** Число страниц, найденное сканером (может быть 0, если словари сжаты в object streams). */
  pageHint: number
  /** В файле найден словарь /Encrypt. */
  encrypted: boolean
}

export type FileStatus =
  | 'pending' // ещё не проанализирован
  | 'ready' // проанализирован, готов к обработке
  | 'locked' // требуется пароль
  | 'queued'
  | 'processing'
  | 'done'
  | 'optimal' // уже оптимально сжат — сохранена копия оригинала
  | 'skipped'
  | 'cancelled'
  | 'error'

export interface FileEntry {
  id: string
  path: string
  name: string
  size: number
}

/** Результат анализа файла. */
export interface FileInfo {
  id: string
  pages: number | null
  /** true — файл зашифрован и для открытия нужен пароль. */
  needsPassword: boolean
  /** Пароль подошёл (если передавался). */
  passwordOk?: boolean
  stats?: ContentStats
  error?: string
}

export interface JobFile {
  id: string
  path: string
  name: string
  size: number
  password?: string
  pages?: number | null
}

export interface OutputTarget {
  mode: OutputMode
  /** Папка для режима 'folder'. */
  dir?: string
}

export type SplitMode = 'all' | 'ranges' | 'visual'

export interface CompressJob {
  kind: 'compress'
  files: JobFile[]
  preset: CompressPreset
  output: OutputTarget
}

export interface MergeJob {
  kind: 'merge'
  files: JobFile[]
  fileName: string
  output: OutputTarget
}

export interface SplitJob {
  kind: 'split'
  files: JobFile[]
  mode: SplitMode
  /** Для 'ranges' — строка диапазонов, общая для всех файлов. */
  ranges?: string
  /** Для 'visual' — выбранные страницы по id файла (1-based). */
  pagesByFile?: Record<string, number[]>
  /** Сохранить выбранное одним PDF (true) или каждый диапазон/страницу отдельно (false). */
  combine: boolean
  output: OutputTarget
}

export type JobRequest = CompressJob | MergeJob | SplitJob

export interface FileProgress {
  jobId: string
  fileId: string
  status: FileStatus
  /** Прогресс конкретного файла 0..1 (если известен). */
  fraction?: number
  outputSize?: number
  outputPath?: string
  outputCount?: number
  message?: string
}

export interface JobProgress {
  jobId: string
  done: number
  total: number
  /** Общая доля выполнения 0..1. */
  fraction: number
  finished: boolean
  cancelled?: boolean
  outputDir?: string
  outputPath?: string
  outputSize?: number
}

export interface ToolsInfo {
  platform: string
  ghostscript: string | null
  qpdf: string | null
  nativeGlass: boolean
  cpus: number
}

export type ThemeSetting = 'light' | 'dark' | 'auto'

export interface PdfApi {
  tools(): Promise<ToolsInfo>
  pickFiles(): Promise<string[]>
  pickFolder(): Promise<string | null>
  /** Разворачивает папки рекурсивно, отбрасывает не-PDF. */
  resolvePaths(paths: string[]): Promise<FileEntry[]>
  /** Анализирует файлы; результаты приходят пачками через onInfo. */
  inspect(files: { id: string; path: string; password?: string }[]): Promise<void>
  onInfo(cb: (infos: FileInfo[]) => void): () => void
  /** Пробное сжатие 1–2 страниц для точного прогноза; результаты — через onRatios. */
  sample(files: { id: string; path: string; password?: string; pages: number }[]): Promise<void>
  onRatios(cb: (r: { id: string; ratios: Record<CompressPreset, number> | null }[]) => void): () => void
  startJob(job: JobRequest): Promise<string>
  cancelJob(jobId: string): Promise<void>
  onFileProgress(cb: (p: FileProgress[]) => void): () => void
  onJobProgress(cb: (p: JobProgress) => void): () => void
  onJobCancelled(cb: (jobId: string) => void): () => void
  showInFolder(path: string): Promise<void>
  openPath(path: string): Promise<void>
  setAppearance(opts: { glass: boolean; dark: boolean; theme: ThemeSetting }): Promise<void>
  getPathForFile(file: File): string
  /** URL для чтения PDF в pdf.js (поддерживает Range-запросы). */
  fileUrl(path: string): string
}
