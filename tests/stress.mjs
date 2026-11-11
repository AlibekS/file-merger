// Нагрузочный прогон (не входит в npm test): 150 файлов ~870 МБ + один PDF ~1.5 ГБ.
// Нужны фикстуры (python3 tests/make_fixtures.py) и qpdf. Запуск: xvfb-run -a node tests/stress.mjs
import { join, resolve } from 'node:path'
import { mkdirSync, rmSync, readdirSync, existsSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron } = require('playwright')
const root = resolve(import.meta.dirname, '..')
const tmp = join(root, 'tests/.tmp')
const out = join(tmp, 'stress-out')
// Подготовка данных: 150 копий скана и один большой PDF из 350 разных файлов.
if (!existsSync(join(tmp, 'big.pdf'))) {
  const fx = join(tmp, 'fixtures')
  mkdirSync(join(tmp, 'stress'), { recursive: true })
  mkdirSync(join(tmp, 'ds'), { recursive: true })
  const parts = []
  for (let i = 1; i <= 150; i++) copyFileSync(join(fx, 'scan.pdf'), join(tmp, 'stress', `scan_${i}.pdf`))
  for (let i = 1; i <= 200; i++) copyFileSync(join(fx, 'docscan.pdf'), join(tmp, 'ds', `d_${i}.pdf`))
  for (let i = 1; i <= 150; i++) parts.push(join(tmp, 'stress', `scan_${i}.pdf`))
  for (let i = 1; i <= 200; i++) parts.push(join(tmp, 'ds', `d_${i}.pdf`))
  execFileSync('qpdf', ['--empty', '--pages', ...parts, '--', join(tmp, 'big.pdf')])
  rmSync(join(tmp, 'ds'), { recursive: true, force: true })
}
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const app = await _electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', root] })
const page = await app.firstWindow()
await page.waitForSelector('.tool-card')

const t = () => performance.now()
const inspect = (paths) =>
  page.evaluate(async (paths) => {
    const entries = await window.pdf.resolvePaths(paths)
    return new Promise((res) => {
      const infos = {}
      const off = window.pdf.onInfo((l) => {
        l.forEach((i) => (infos[i.id] = i))
        if (Object.keys(infos).length === entries.length) {
          off()
          res(entries.map((e) => ({ ...e, info: infos[e.id] })))
        }
      })
      window.pdf.inspect(entries.map((e) => ({ id: e.id, path: e.path })))
    })
  }, paths)
const runJob = (job) =>
  page.evaluate(
    (job) =>
      new Promise((res) => {
        let id
        const st = {}
        const offF = window.pdf.onFileProgress((l) => l.forEach((p) => (st[p.status] = (st[p.status] ?? 0) + 0, (st[p.fileId] = p.status))))
        const off = window.pdf.onJobProgress((p) => {
          if (p.jobId === id && p.finished) {
            off()
            offF()
            const counts = {}
            Object.entries(st).forEach(([k, v]) => k.startsWith('f') && typeof v === 'string' && (counts[v] = (counts[v] ?? 0) + 1))
            res({ p, counts })
          }
        })
        window.pdf.startJob(job).then((x) => (id = x))
      }),
    job
  )

let s = t()
const batch = await inspect([join(tmp, 'stress')])
console.log(`анализ ${batch.length} файлов: ${Math.round(t() - s)} мс`)

s = t()
const [big] = await inspect([join(tmp, 'big.pdf')])
console.log(`анализ big.pdf (${(big.size / 2 ** 30).toFixed(2)} ГБ, ${big.info.pages} стр.): ${Math.round(t() - s)} мс, изображений ${(big.info.stats.imageBytes / 2 ** 20).toFixed(0)} МБ`)

// UI остаётся отзывчивым во время пакетного сжатия: замеряем задержку кадров.
const jf = (e) => ({ id: e.id, path: e.path, name: e.name, size: e.size, pages: e.info.pages })
s = t()
const lagProbe = page.evaluate(
  () =>
    new Promise((res) => {
      let worst = 0
      let last = performance.now()
      const end = last + 8000
      const tick = (now) => {
        worst = Math.max(worst, now - last)
        last = now
        if (now < end) requestAnimationFrame(tick)
        else res(worst)
      }
      requestAnimationFrame(tick)
    })
)
const job = runJob({ kind: 'compress', preset: 'medium', output: { mode: 'folder', dir: join(out, 'c') }, files: batch.map(jf) })
console.log(`макс. пауза между кадрами во время сжатия: ${Math.round(await lagProbe)} мс`)
const r = await job
console.log(`сжатие ${batch.length} файлов: ${Math.round((t() - s) / 1000)} с`, r.counts)

s = t()
const m = await runJob({ kind: 'merge', fileName: 'big_merged.pdf', output: { mode: 'folder', dir: out }, files: [jf(big), ...batch.slice(0, 50).map(jf)] })
console.log(`объединение 1.5 ГБ + 50 файлов: ${Math.round((t() - s) / 1000)} с →`, m.p.outputPath, m.counts)

s = t()
const sp = await runJob({ kind: 'split', mode: 'ranges', ranges: '1-10, 500-510, 1150-', combine: false, output: { mode: 'folder', dir: join(out, 's') }, files: [jf(big)] })
console.log(`разделение big.pdf по диапазонам: ${Math.round((t() - s) / 1000)} с`, readdirSync(join(out, 's', 'big_split')))
await app.close()
