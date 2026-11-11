import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, shell } from 'electron'
import { join, resolve as resolvePath } from 'node:path'
import { release as osRelease } from 'node:os'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { collectPdfs } from './fsutil'
import { inspect, sampleRatios } from './engine'
import { findTools } from './tools'
import { startJob, cancelJob, concurrency } from './jobs'
import { runPool } from './proc'
import type { FileInfo, JobRequest, ToolsInfo } from '../shared/types'

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

// Схема для чтения выбранных PDF в pdf.js (миниатюры) с поддержкой Range.
protocol.registerSchemesAsPrivileged([
  { scheme: 'pdfstudio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

/** Только файлы, выбранные пользователем, доступны через протокол. */
const allowedFiles = new Set<string>()

function supportsNativeGlass(): boolean {
  if (isMac) return true
  if (isWin) {
    const build = Number(osRelease().split('.')[2] ?? 0)
    return build >= 22621 // Windows 11 22H2+: Mica / Acrylic
  }
  return false
}

let win: BrowserWindow | null = null
let glassOn = false
let darkOn = false
let themeSource: 'light' | 'dark' | 'system' = 'system'

function solidBg(dark: boolean): string {
  return dark ? '#0F1115' : '#F5F7FA'
}

function applyAppearance(): void {
  if (!win) return
  nativeTheme.themeSource = themeSource
  const native = glassOn && supportsNativeGlass()
  if (isMac) {
    win.setVibrancy(native ? 'under-window' : null)
  } else if (isWin && supportsNativeGlass()) {
    win.setBackgroundMaterial(native ? 'acrylic' : 'none')
  }
  win.setBackgroundColor(native ? '#00000000' : solidBg(darkOn))
  if (isWin) {
    try {
      win.setTitleBarOverlay({
        color: native ? '#00000000' : solidBg(darkOn),
        symbolColor: darkOn ? '#F3F4F6' : '#1F2937',
        height: 52
      })
    } catch {
      /* старые версии Windows */
    }
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: 'PDF Studio',
    backgroundColor: solidBg(nativeTheme.shouldUseDarkColors),
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } } : {}),
    ...(isWin
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: solidBg(nativeTheme.shouldUseDarkColors),
            symbolColor: nativeTheme.shouldUseDarkColors ? '#F3F4F6' : '#1F2937',
            height: 52
          }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })

  // Перетаскивание файла на окно не должно открывать его как страницу.
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerProtocol(): void {
  protocol.handle('pdfstudio', async (request) => {
    const url = new URL(request.url)
    const path = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (!allowedFiles.has(path)) return new Response('Forbidden', { status: 403 })
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/pdf',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Length'
    }
    const range = request.headers.get('Range')
    const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (m) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
      }
      const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
      return new Response(stream, {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
      })
    }
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream
    return new Response(stream, { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
  })
}

function registerIpc(): void {
  ipcMain.handle('app:tools', (): ToolsInfo => {
    const t = findTools()
    return {
      platform: process.platform,
      ghostscript: t.gs,
      qpdf: t.qpdf,
      nativeGlass: supportsNativeGlass(),
      cpus: concurrency()
    }
  })

  ipcMain.handle('dialog:files', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Выберите PDF файлы',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf', 'PDF'] }]
    })
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Куда сохранить',
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('files:resolve', async (_e, paths: string[]) => {
    const entries = await collectPdfs(paths.map((p) => resolvePath(p)))
    for (const f of entries) allowedFiles.add(f.path)
    return entries
  })

  ipcMain.handle('files:inspect', (e, files: { id: string; path: string; password?: string }[]) => {
    const wc = e.sender
    let batch: FileInfo[] = []
    let timer: NodeJS.Timeout | null = null
    const flush = (): void => {
      timer = null
      if (batch.length && !wc.isDestroyed()) wc.send('files:info', batch)
      batch = []
    }
    // Анализ в фоне: ответ IPC приходит сразу, результаты — пачками.
    void runPool(files, concurrency() * 2, async (f) => {
      let info: FileInfo
      try {
        info = await inspect(f.id, f.path, f.password)
      } catch (err) {
        info = { id: f.id, pages: null, needsPassword: false, error: (err as Error).message }
      }
      batch.push(info)
      if (batch.length >= 200) flush()
      else if (!timer) timer = setTimeout(flush, 60)
    }).then(() => {
      if (timer) clearTimeout(timer)
      flush()
    })
  })

  // Очередь пробного сжатия (уточнение прогноза). Половина ядер, чтобы не мешать работе.
  const sampleQueue: { id: string; path: string; password?: string; pages: number; wc: Electron.WebContents }[] = []
  let sampling = 0
  const pumpSamples = (): void => {
    const limit = Math.max(1, Math.floor(concurrency() / 2))
    while (sampling < limit && sampleQueue.length) {
      const t = sampleQueue.shift()!
      if (t.wc.isDestroyed()) continue
      sampling++
      void sampleRatios(t.path, t.pages, t.password)
        .then((ratios) => {
          if (!t.wc.isDestroyed()) t.wc.send('files:ratios', [{ id: t.id, ratios }])
        })
        .finally(() => {
          sampling--
          pumpSamples()
        })
    }
  }
  ipcMain.handle('files:sample', (e, files: { id: string; path: string; password?: string; pages: number }[]) => {
    for (const f of files) sampleQueue.push({ ...f, wc: e.sender })
    pumpSamples()
  })

  ipcMain.handle('job:start', (e, req: JobRequest) => startJob(e.sender, req))
  ipcMain.handle('job:cancel', (_e, id: string) => cancelJob(id))
  ipcMain.handle('shell:show', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell:open', async (_e, p: string) => {
    await shell.openPath(p)
  })
  ipcMain.handle('app:appearance', (_e, opts: { glass: boolean; dark: boolean; theme: 'light' | 'dark' | 'auto' }) => {
    glassOn = opts.glass
    darkOn = opts.dark
    themeSource = opts.theme === 'auto' ? 'system' : opts.theme
    applyAppearance()
  })
}

app.whenReady().then(() => {
  registerProtocol()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
