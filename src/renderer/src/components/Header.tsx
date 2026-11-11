import { Icon } from '../icons'
import type { ThemeSetting } from '../../../shared/types'

export interface Appearance {
  theme: ThemeSetting
  glass: boolean
  /** Глубина прозрачности 0..100 */
  depth: number
}

export function Header({ value, onChange }: { value: Appearance; onChange: (v: Appearance) => void }) {
  const set = (patch: Partial<Appearance>) => onChange({ ...value, ...patch })
  const themes: { id: ThemeSetting; label: string; icon: (p: object) => React.ReactNode }[] = [
    { id: 'light', label: 'Светлая', icon: Icon.Sun },
    { id: 'dark', label: 'Тёмная', icon: Icon.Moon },
    { id: 'auto', label: 'Авто', icon: Icon.Auto }
  ]
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark">PDF</span>
        <span className="brand-name">PDF Studio</span>
      </div>
      <div className="settings-bar surface" role="toolbar" aria-label="Внешний вид">
        <div className="seg" role="group" aria-label="Тема">
          {themes.map((t) => (
            <button
              key={t.id}
              aria-pressed={value.theme === t.id}
              onClick={() => set({ theme: t.id })}
              title={t.id === 'auto' ? 'Как в системе' : t.label}
            >
              {t.icon({ width: 14, height: 14 })}
              <span className="lbl">{t.label}</span>
            </button>
          ))}
        </div>
        <button
          className="toggle"
          role="switch"
          aria-checked={value.glass}
          onClick={() => set({ glass: !value.glass })}
          title="Эффект «жидкого стекла»"
        >
          <span className="track" />
          Liquid Glass
        </button>
        <label className="depth" data-hidden={!value.glass} aria-hidden={!value.glass}>
          Глубина
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={value.depth}
            disabled={!value.glass}
            style={{ ['--fill' as string]: `${value.depth}%` }}
            onChange={(e) => set({ depth: Number(e.target.value) })}
            aria-label="Глубина прозрачности"
          />
          <output>{value.depth}%</output>
        </label>
      </div>
    </header>
  )
}
