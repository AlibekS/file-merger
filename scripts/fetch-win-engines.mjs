// Скачивает Windows-сборки Ghostscript и qpdf и раскладывает их в resources/bin/win,
// откуда electron-builder упаковывает их в установщик. Нужен 7-Zip (7z) в PATH.
// Запуск: node scripts/fetch-win-engines.mjs
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const QPDF_VERSION = '12.2.0'
const GS_TAG = 'gs10060'
const QPDF_URL = `https://github.com/qpdf/qpdf/releases/download/v${QPDF_VERSION}/qpdf-${QPDF_VERSION}-msvc64.zip`
const GS_URL = `https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/${GS_TAG}/${GS_TAG}w64.exe`

const root = resolve(import.meta.dirname, '..')
const dest = join(root, 'resources/bin/win')
const work = join(tmpdir(), `pdfstudio-engines-${Date.now()}`)
mkdirSync(work, { recursive: true })

async function download(url, file) {
  console.log('↓', url)
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  writeFileSync(file, Buffer.from(await r.arrayBuffer()))
}
const sevenZip = process.platform === 'win32' && existsSync('C:\\Program Files\\7-Zip\\7z.exe') ? 'C:\\Program Files\\7-Zip\\7z.exe' : '7z'
const extract = (archive, out) => execFileSync(sevenZip, ['x', '-y', `-o${out}`, archive], { stdio: 'ignore' })

await download(QPDF_URL, join(work, 'qpdf.zip'))
await download(GS_URL, join(work, 'gs.exe'))
extract(join(work, 'qpdf.zip'), join(work, 'qpdf'))
extract(join(work, 'gs.exe'), join(work, 'gs')) // установщик NSIS распаковывается 7-Zip

const q = join(work, 'qpdf', `qpdf-${QPDF_VERSION}-msvc64`)
const g = join(work, 'gs')
for (const d of ['gs', 'qpdf']) rmSync(join(dest, d), { recursive: true, force: true })
mkdirSync(join(dest, 'gs/bin'), { recursive: true })
mkdirSync(join(dest, 'qpdf/bin'), { recursive: true })

for (const f of ['gswin64c.exe', 'gsdll64.dll']) cpSync(join(g, 'bin', f), join(dest, 'gs/bin', f))
cpSync(join(g, 'lib'), join(dest, 'gs/lib'), { recursive: true })
cpSync(join(g, 'doc/COPYING'), join(dest, 'gs/COPYING'))
for (const f of ['qpdf.exe', 'qpdf30.dll']) cpSync(join(q, 'bin', f), join(dest, 'qpdf/bin', f))
cpSync(join(q, 'share/doc/qpdf/manual-html/_sources/license.rst.txt'), join(dest, 'qpdf/LICENSE.txt'))
// Среда выполнения Visual C++ (нужна обоим движкам) — локально, без отдельной установки.
const vc = ['msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'msvcp140_atomic_wait.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'concrt140.dll']
for (const f of vc) {
  if (!existsSync(join(q, 'bin', f))) continue
  cpSync(join(q, 'bin', f), join(dest, 'qpdf/bin', f))
  cpSync(join(q, 'bin', f), join(dest, 'gs/bin', f))
}
rmSync(work, { recursive: true, force: true })
console.log('✓ движки разложены в', dest)
