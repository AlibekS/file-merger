// Сквозные тесты: запускают собранное приложение и проверяют движок через реальный IPC.
// Запуск: npm run build && python3 tests/make_fixtures.py && xvfb-run -a node --test tests/
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, statSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { _electron } = require('playwright')

const root = resolve(import.meta.dirname, '..')
const fx = join(root, 'tests/.tmp/fixtures')
const outDir = join(root, 'tests/.tmp/out')
let app, page

const pages = (p) => Number(execFileSync('qpdf', ['--show-npages', p]).toString())

/** Запускает задание и ждёт его завершения, собирая прогресс файлов. */
async function runJob(job) {
  return page.evaluate(
    (job) =>
      new Promise((resolve) => {
        const files = {}
        const offF = window.pdf.onFileProgress((list) => list.forEach((p) => (files[p.fileId] = p)))
        let id = null
        const offJ = window.pdf.onJobProgress((p) => {
          if (p.jobId === id && p.finished) {
            offF()
            offJ()
            setTimeout(() => resolve({ job: p, files }), 50)
          }
        })
        window.pdf.startJob(job).then((x) => (id = x))
      }),
    job
  )
}

async function inspect(paths, passwords = {}) {
  return page.evaluate(
    async ({ paths, passwords }) => {
      const entries = await window.pdf.resolvePaths(paths)
      return new Promise((resolve) => {
        const infos = {}
        const off = window.pdf.onInfo((list) => {
          list.forEach((i) => (infos[i.id] = i))
          if (Object.keys(infos).length === entries.length) {
            off()
            resolve(entries.map((e) => ({ ...e, info: infos[e.id] })))
          }
        })
        window.pdf.inspect(entries.map((e) => ({ id: e.id, path: e.path, password: passwords[e.name] })))
      })
    },
    { paths, passwords }
  )
}

const jf = (e, extra = {}) => ({ id: e.id, path: e.path, name: e.name, size: e.size, pages: e.info?.pages, ...extra })

before(async () => {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  app = await _electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', root], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } })
  page = await app.firstWindow()
  await page.waitForSelector('.tool-card')
})

after(async () => {
  await app?.close()
})

test('главный экран: три карточки', async () => {
  const titles = await page.$$eval('.tool-card h2', (els) => els.map((e) => e.textContent))
  assert.deepEqual(titles, ['Объединить PDF', 'Разделить PDF', 'Сжать PDF'])
})

test('анализ: страницы, пароль, повреждённый файл, папки', async () => {
  const res = await inspect([fx])
  const by = Object.fromEntries(res.map((r) => [r.path.replace(fx + '/', ''), r.info]))
  assert.equal(by['text.pdf'].pages, 12)
  assert.equal(by['scan.pdf'].pages, 4)
  assert.ok(by['scan.pdf'].stats.imageBytes > 5_000_000, 'изображения скана найдены')
  assert.equal(by['locked.pdf'].needsPassword, true)
  assert.ok(by['broken.pdf'].error, 'повреждённый файл помечен ошибкой')
  assert.ok(by['folder/a.pdf'] && by['folder/sub/b.pdf'], 'папка обойдена рекурсивно')
  assert.ok(!Object.keys(by).some((k) => k.endsWith('.txt')))

  const [locked] = await inspect([join(fx, 'locked.pdf')], { 'locked.pdf': 'secret' })
  assert.equal(locked.info.passwordOk, true)
  assert.equal(locked.info.pages, 12)
})

test('сжатие: три пресета уменьшают скан', async () => {
  const [scan] = await inspect([join(fx, 'scan.pdf')])
  const { estimateCompressed } = await import('../src/shared/estimate.ts').catch((e) => (console.log(e.message), {}))
  for (const preset of ['light', 'medium', 'ultra']) {
    const dir = join(outDir, `compress-${preset}`)
    mkdirSync(dir, { recursive: true })
    const { files } = await runJob({ kind: 'compress', preset, output: { mode: 'folder', dir }, files: [jf(scan)] })
    const r = files[scan.id]
    assert.ok(['done', 'optimal'].includes(r.status), `${preset}: ${r.status} ${r.message ?? ''}`)
    assert.ok(existsSync(r.outputPath))
    assert.equal(pages(r.outputPath), 4)
    if (estimateCompressed) {
      const est = estimateCompressed(scan.info.stats, preset)
      console.log(`${preset}: ${scan.size} → факт ${r.outputSize}, прогноз ${est}`)
    }
    if (preset !== 'light') assert.ok(r.outputSize < scan.size * 0.5, `${preset} сжал: ${r.outputSize}`)
  }
})

test('сжатие: уже сжатый файл → копия оригинала, зашифрованный без пароля → locked', async () => {
  const dir = join(outDir, 'compress-misc')
  const [text, locked, broken] = await inspect([join(fx, 'text.pdf'), join(fx, 'locked.pdf'), join(fx, 'broken.pdf')])
  const { files, job } = await runJob({
    kind: 'compress',
    preset: 'light',
    output: { mode: 'folder', dir },
    files: [jf(text), jf(locked), jf(broken)]
  })
  assert.equal(job.done, 3)
  assert.ok(['done', 'optimal'].includes(files[text.id].status))
  assert.equal(files[locked.id].status, 'locked')
  assert.equal(files[broken.id].status, 'error')

  const { files: f2 } = await runJob({
    kind: 'compress',
    preset: 'medium',
    output: { mode: 'folder', dir },
    files: [jf(locked, { password: 'secret' })]
  })
  assert.ok(['done', 'optimal'].includes(f2[locked.id].status), f2[locked.id].message)
})

test('сжатие в исходную папку добавляет суффикс _compressed', async () => {
  const src = join(outDir, 'src')
  mkdirSync(src, { recursive: true })
  execFileSync('cp', [join(fx, 'scan.pdf'), join(src, 'doc.pdf')])
  const [e] = await inspect([join(src, 'doc.pdf')])
  const { files } = await runJob({ kind: 'compress', preset: 'ultra', output: { mode: 'source' }, files: [jf(e)] })
  assert.equal(files[e.id].outputPath, join(src, 'doc_compressed.pdf'))
  assert.ok(existsSync(join(src, 'doc.pdf')), 'оригинал не тронут')
})

test('объединение сохраняет порядок и число страниц', async () => {
  const list = await inspect([join(fx, 'text.pdf'), join(fx, 'scan.pdf'), join(fx, 'locked.pdf')], { 'locked.pdf': 'secret' })
  const { job } = await runJob({
    kind: 'merge',
    fileName: 'merged_document.pdf',
    output: { mode: 'folder', dir: outDir },
    files: list.map((e) => jf(e, e.name === 'locked.pdf' ? { password: 'secret' } : {}))
  })
  assert.equal(job.outputPath, join(outDir, 'merged_document.pdf'))
  assert.equal(pages(job.outputPath), 12 + 4 + 12)
})

test('разделение: все страницы, диапазоны, визуальный выбор', async () => {
  const [text] = await inspect([join(fx, 'text.pdf')])
  const d1 = join(outDir, 'split-all')
  await runJob({ kind: 'split', mode: 'all', combine: false, output: { mode: 'folder', dir: d1 }, files: [jf(text)] })
  const names = readdirSync(join(d1, 'text_split'))
  assert.equal(names.length, 12)
  assert.ok(names.includes('page_001.pdf') && names.includes('page_012.pdf'))

  const d2 = join(outDir, 'split-ranges')
  await runJob({ kind: 'split', mode: 'ranges', ranges: '1-3, 5, 10-', combine: false, output: { mode: 'folder', dir: d2 }, files: [jf(text)] })
  const r = readdirSync(join(d2, 'text_split')).sort()
  assert.deepEqual(r, ['text_pages_1-3.pdf', 'text_pages_10-12.pdf', 'text_pages_5.pdf'])
  assert.equal(pages(join(d2, 'text_split', 'text_pages_10-12.pdf')), 3)

  const d3 = join(outDir, 'split-combined')
  await runJob({ kind: 'split', mode: 'ranges', ranges: '1-3, 5', combine: true, output: { mode: 'folder', dir: d3 }, files: [jf(text)] })
  assert.equal(pages(join(d3, 'text_split.pdf')), 4)

  const d4 = join(outDir, 'split-visual')
  await runJob({ kind: 'split', mode: 'visual', combine: true, pagesByFile: { [text.id]: [2, 4, 6] }, output: { mode: 'folder', dir: d4 }, files: [jf(text)] })
  assert.equal(pages(join(d4, 'text_split.pdf')), 3)
})

test('отмена останавливает пакет', async () => {
  const many = Array.from({ length: 40 }, () => join(fx, 'scan.pdf'))
  const [scan] = await inspect([join(fx, 'scan.pdf')])
  const dir = join(outDir, 'cancel')
  const files = many.map((p, i) => jf({ ...scan, id: `c${i}` }))
  const result = page.evaluate(
    (job) =>
      new Promise((resolve) => {
        let id = null
        const off = window.pdf.onJobProgress((p) => {
          if (p.jobId === id && p.finished) {
            off()
            resolve(p)
          }
        })
        window.pdf.startJob(job).then((x) => {
          id = x
          setTimeout(() => window.pdf.cancelJob(x), 400)
        })
      }),
    { kind: 'compress', preset: 'medium', output: { mode: 'folder', dir }, files }
  )
  const p = await result
  assert.equal(p.cancelled, true)
  const produced = existsSync(dir) ? readdirSync(dir) : []
  assert.ok(produced.length < 40, `обработано до отмены: ${produced.length}`)
  assert.ok(!produced.some((n) => n.endsWith('.part')), 'нет недописанных файлов')
})

test('прогноз по пробному сжатию точен (±35%)', async () => {
  for (const name of ['scan.pdf', 'docscan.pdf']) {
    const [e] = await inspect([join(fx, name)])
    const ratios = await page.evaluate(
      (f) =>
        new Promise((resolve) => {
          const off = window.pdf.onRatios((list) => {
            const r = list.find((x) => x.id === f.id)
            if (r) {
              off()
              resolve(r.ratios)
            }
          })
          window.pdf.sample([f])
        }),
      { id: e.id, path: e.path, pages: e.info.pages }
    )
    assert.ok(ratios, 'пробное сжатие выполнено')
    for (const preset of ['medium', 'ultra']) {
      const dir = join(outDir, `acc-${preset}`)
      const { files } = await runJob({ kind: 'compress', preset, output: { mode: 'folder', dir }, files: [jf(e)] })
      const actual = files[e.id].outputSize
      const predicted = e.size * ratios[preset]
      console.log(`${name} ${preset}: прогноз ${Math.round(predicted)}, факт ${actual}`)
      assert.ok(Math.abs(predicted - actual) / actual < 0.35, `${name}/${preset}: ${predicted} vs ${actual}`)
    }
  }
})
