// Поиск внешних движков: Ghostscript (глубокое сжатие) и qpdf (быстрые
// структурные операции). Сначала ищем бинарники, поставляемые вместе
// с приложением (resources/bin), затем стандартные пути установки и PATH.

import { existsSync, readdirSync } from 'node:fs'
import { join, delimiter } from 'node:path'
import { app } from 'electron'

const isWin = process.platform === 'win32'
const exe = (name: string): string => (isWin ? `${name}.exe` : name)

function bundledBinDirs(): string[] {
  const dirs: string[] = []
  const plat = process.platform === 'darwin' ? 'mac' : isWin ? 'win' : 'linux'
  // В собранном приложении: <resources>/bin; при разработке: ./resources/bin/<platform>
  if (process.resourcesPath) dirs.push(join(process.resourcesPath, 'bin'))
  const root = app.getAppPath()
  dirs.push(join(root, 'resources', 'bin', plat), join(root, 'resources', 'bin'))
  // bin/ рядом с бинарником может содержать вложенную структуру (gs/bin, qpdf/bin)
  return dirs.flatMap((d) => [d, join(d, 'gs', 'bin'), join(d, 'qpdf', 'bin')])
}

function pathDirs(): string[] {
  const extra = isWin
    ? []
    : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/opt/local/bin', '/snap/bin']
  return [...(process.env.PATH ?? '').split(delimiter), ...extra].filter(Boolean)
}

function findIn(dirs: string[], names: string[]): string | null {
  for (const d of dirs) {
    for (const n of names) {
      const p = join(d, n)
      if (existsSync(p)) return p
    }
  }
  return null
}

/** Windows: C:\Program Files\gs\gs10.xx\bin\gswin64c.exe */
function windowsGhostscriptInstalls(): string[] {
  const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], 'C:\\Program Files']
  const out: string[] = []
  for (const r of roots) {
    if (!r) continue
    const base = join(r, 'gs')
    if (!existsSync(base)) continue
    try {
      const versions = readdirSync(base).filter((v) => v.startsWith('gs')).sort().reverse()
      for (const v of versions) out.push(join(base, v, 'bin'))
    } catch {
      /* нет доступа — пропускаем */
    }
  }
  return out
}

function windowsQpdfInstalls(): string[] {
  const roots = [process.env['ProgramFiles'], 'C:\\Program Files']
  const out: string[] = []
  for (const r of roots) {
    if (!r || !existsSync(r)) continue
    try {
      for (const d of readdirSync(r)) if (/^qpdf/i.test(d)) out.push(join(r, d, 'bin'))
    } catch {
      /* пропускаем */
    }
  }
  return out
}

let cache: { gs: string | null; qpdf: string | null } | null = null

export function findTools(): { gs: string | null; qpdf: string | null } {
  if (cache) return cache
  const gsNames = isWin ? ['gswin64c.exe', 'gswin32c.exe', 'gs.exe'] : ['gs']
  const bundled = bundledBinDirs()
  const gs =
    process.env.PDFSTUDIO_GS ||
    findIn(bundled, gsNames) ||
    (isWin ? findIn(windowsGhostscriptInstalls(), gsNames) : null) ||
    findIn(pathDirs(), gsNames)
  const qpdf =
    process.env.PDFSTUDIO_QPDF ||
    findIn(bundled, [exe('qpdf')]) ||
    (isWin ? findIn(windowsQpdfInstalls(), [exe('qpdf')]) : null) ||
    findIn(pathDirs(), [exe('qpdf')])
  // Значение «none» в переменной окружения отключает движок (для проверки резервного режима).
  cache = {
    gs: gs && gs !== 'none' ? gs : null,
    qpdf: qpdf && qpdf !== 'none' ? qpdf : null
  }
  return cache
}
