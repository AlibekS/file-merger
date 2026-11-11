import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

/** Стрелка из (x1,y1) в (x2,y2) с наконечником в конечной точке. */
function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const len = 5.2
  const h1 = [x2 - len * Math.cos(a - Math.PI / 4), y2 - len * Math.sin(a - Math.PI / 4)]
  const h2 = [x2 - len * Math.cos(a + Math.PI / 4), y2 - len * Math.sin(a + Math.PI / 4)]
  return (
    <g stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <polyline points={`${h1[0]},${h1[1]} ${x2},${y2} ${h2[0]},${h2[1]}`} />
    </g>
  )
}

const CORAL = '#EF6A4C'
const CORAL_2 = '#F37E5F'
const GREEN = '#8CC152'

/** Объединить: два пересекающихся квадрата, стрелки внутрь. */
export function MergeIcon(props: P) {
  return (
    <svg viewBox="0 0 56 56" aria-hidden {...props}>
      <rect x="2" y="2" width="30" height="30" rx="4.5" fill={CORAL} />
      <rect x="24" y="24" width="30" height="30" rx="4.5" fill={CORAL_2} stroke="#fff" strokeOpacity="0" />
      <line x1="25" y1="31" x2="31" y2="25" stroke="#fff" strokeWidth="1.6" strokeDasharray="1.6 2.4" strokeLinecap="round" />
      <Arrow x1={10} y1={10} x2={19.5} y2={19.5} />
      <Arrow x1={46} y1={46} x2={36.5} y2={36.5} />
    </svg>
  )
}

/** Разделить: два пересекающихся квадрата, стрелки наружу. */
export function SplitIcon(props: P) {
  return (
    <svg viewBox="0 0 56 56" aria-hidden {...props}>
      <rect x="2" y="2" width="30" height="30" rx="4.5" fill={CORAL} />
      <rect x="24" y="24" width="30" height="30" rx="4.5" fill={CORAL_2} />
      <line x1="25" y1="31" x2="31" y2="25" stroke="#fff" strokeWidth="1.6" strokeDasharray="1.6 2.4" strokeLinecap="round" />
      <Arrow x1={19.5} y1={19.5} x2={10} y2={10} />
      <Arrow x1={36.5} y1={36.5} x2={46} y2={46} />
    </svg>
  )
}

/** Сжать: четыре квадрата, стрелки к центру. */
export function CompressIcon(props: P) {
  return (
    <svg viewBox="0 0 56 56" aria-hidden {...props}>
      <rect x="3" y="3" width="21" height="21" rx="3.5" fill={GREEN} />
      <rect x="32" y="3" width="21" height="21" rx="3.5" fill={GREEN} />
      <rect x="3" y="32" width="21" height="21" rx="3.5" fill={GREEN} />
      <rect x="32" y="32" width="21" height="21" rx="3.5" fill={GREEN} />
      <Arrow x1={9} y1={9} x2={17.5} y2={17.5} />
      <Arrow x1={47} y1={9} x2={38.5} y2={17.5} />
      <Arrow x1={9} y1={47} x2={17.5} y2={38.5} />
      <Arrow x1={47} y1={47} x2={38.5} y2={38.5} />
    </svg>
  )
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export const Icon = {
  Back: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} {...p}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  Plus: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Folder: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  Check: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.6} {...p}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  X: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  Up: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} {...p}>
      <path d="M6 15l6-6 6 6" />
    </svg>
  ),
  Down: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} {...p}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  Grip: (p: P) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      {[6, 12, 18].map((y) => (
        <g key={y}>
          <circle cx="9" cy={y} r="1.6" />
          <circle cx="15" cy={y} r="1.6" />
        </g>
      ))}
    </svg>
  ),
  Lock: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} {...p}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  Alert: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} {...p}>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18h.01" />
    </svg>
  ),
  Sun: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  Moon: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} {...p}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  ),
  Auto: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} {...p}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
  Trash: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} {...p}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  ),
  External: (p: P) => (
    <svg viewBox="0 0 24 24" {...stroke} {...p}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

/** Иконка файла PDF для строк списка. */
export function PdfFileIcon({ status }: { status?: 'ok' | 'err' | 'lock' }) {
  const color = status === 'err' ? '#E5484D' : status === 'lock' ? '#E8A33D' : '#EF6A4C'
  return (
    <svg viewBox="0 0 34 40" aria-hidden>
      <path d="M4 1h18l11 11v25a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" fill="var(--surface-2)" stroke="var(--border-strong)" />
      <path d="M22 1v9a2 2 0 0 0 2 2h9" fill="none" stroke="var(--border-strong)" />
      <rect x="0" y="21" width="24" height="12" rx="3" fill={color} />
      <text x="12" y="30" textAnchor="middle" fontSize="8" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">
        PDF
      </text>
    </svg>
  )
}
