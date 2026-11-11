import { useEffect, useState } from 'react'
import { Header, type Appearance } from './components/Header'
import { Home } from './components/Home'
import { CompressView } from './views/CompressView'
import { MergeView } from './views/MergeView'
import { SplitView } from './views/SplitView'
import { usePersistent } from './persist'
import type { ToolKind, ToolsInfo } from '../../shared/types'

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

export function App() {
  const [appearance, setAppearance] = usePersistent<Appearance>('appearance', { theme: 'auto', glass: false, depth: 50 })
  const [tool, setTool] = useState<ToolKind | null>(null)
  const [tools, setTools] = useState<ToolsInfo | null>(null)
  // В режиме «Авто» main-процесс ставит nativeTheme.themeSource = 'system',
  // поэтому media-запрос отражает реальную тему ОС и меняется вместе с ней.
  const systemDark = useSystemDark()
  const dark = appearance.theme === 'auto' ? systemDark : appearance.theme === 'dark'

  useEffect(() => {
    void window.pdf.tools().then(setTools)
  }, [])

  // Применение темы и Liquid Glass.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = dark ? 'dark' : 'light'
    const native = !!tools?.nativeGlass
    root.dataset.glass = appearance.glass ? (native ? 'native' : 'emulated') : 'off'
    root.dataset.platform = tools?.platform ?? ''
    const d = appearance.depth / 100
    // 0% → плотные панели (0.85, blur 8px); 100% → максимально прозрачные (0.25, blur 32px)
    root.style.setProperty('--glass-alpha', (0.85 - 0.6 * d).toFixed(3))
    root.style.setProperty('--glass-blur', `${Math.round(8 + 24 * d)}px`)
    root.style.setProperty('--glass-sat', `${Math.round(140 + 60 * d)}%`)
    root.dataset.contrast = appearance.glass && d > 0.55 ? 'high' : 'normal'
    void window.pdf.setAppearance({ glass: appearance.glass, dark, theme: appearance.theme })
  }, [appearance, dark, tools])

  return (
    <div className="app">
      <div className="backdrop" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <Header value={appearance} onChange={setAppearance} />
      <main className="main">
        {tool === null && <Home onOpen={setTool} tools={tools} />}
        {tool === 'compress' && <CompressView onBack={() => setTool(null)} tools={tools} />}
        {tool === 'merge' && <MergeView onBack={() => setTool(null)} />}
        {tool === 'split' && <SplitView onBack={() => setTool(null)} />}
      </main>
    </div>
  )
}
