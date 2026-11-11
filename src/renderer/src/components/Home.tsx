import { CompressIcon, MergeIcon, SplitIcon } from '../icons'
import type { ToolKind } from '../../../shared/types'

export const TOOLS: { id: ToolKind; title: string; desc: string; Icon: typeof MergeIcon }[] = [
  {
    id: 'merge',
    title: 'Объединить PDF',
    desc: 'Объединяйте PDF файлы и упорядочите их легко и быстро в любом порядке, который вам нравится.',
    Icon: MergeIcon
  },
  {
    id: 'split',
    title: 'Разделить PDF',
    desc: 'Выбирайте диапазон страниц, одну страницу или преобразовывайте каждую страницу документа в независимый PDF-файл.',
    Icon: SplitIcon
  },
  {
    id: 'compress',
    title: 'Сжать PDF',
    desc: 'Уменьшайте размер вашего PDF файла, и при этом сохраняйте качество. Оптимизируйте ваши PDF файлы.',
    Icon: CompressIcon
  }
]

export function Home({ onOpen }: { onOpen: (t: ToolKind) => void }) {
  return (
    <div className="home">
      <h1>Всё для работы с PDF</h1>
      <p className="lead">Локально на вашем компьютере. Без загрузки в облако, без лимитов по количеству и размеру файлов.</p>
      <div className="cards">
        {TOOLS.map(({ id, title, desc, Icon }) => (
          <button key={id} className="tool-card surface" onClick={() => onOpen(id)}>
            <Icon />
            <h2>{title}</h2>
            <p>{desc}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
