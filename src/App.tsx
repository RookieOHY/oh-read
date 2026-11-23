/**
 * 应用外壳 + 书架页
 *
 * 结构：
 *   标题栏（原生交通灯 + 工具按钮）
 *   侧边栏（书架 / 正在阅读 / 书单 / 设置）
 *   主内容区（书架网格 或 各页占位）
 *
 * 导入途径：
 *   1. 工具栏「添加」按钮 → 系统文件选择器
 *   2. 把文件直接拖进窗口（任意位置）
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { BookRecord } from './core/Book'
import { addBook, deleteBook, getAllBooks } from './core/Storage'
import { extractBookMeta, generateId } from './providers/epubMeta'
import Library from './components/Library'

type IconName =
  | 'books'
  | 'reading'
  | 'lists'
  | 'settings'
  | 'plus'
  | 'search'
  | 'sun'
  | 'moon'
  | 'laptop'

const iconPaths: Record<IconName, ReactNode> = {
  books: (
    <>
      <rect x="3" y="4" width="14" height="16" rx="2" />
      <path d="M7 4v16" />
    </>
  ),
  reading: (
    <>
      <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H11v16H5.5A2.5 2.5 0 0 0 3 21.5z" />
      <path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H13v16h5.5a2.5 2.5 0 0 1 2.5 2.5z" />
    </>
  ),
  lists: (
    <>
      <path d="M9 6h12M9 12h12M9 18h12" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.12.4.5.7.94.7H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.3z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  laptop: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </>
  ),
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  )
}

type Theme = 'system' | 'light' | 'dark'

const NAV_ITEMS: { id: string; label: string; icon: IconName }[] = [
  { id: 'library', label: '书架', icon: 'books' },
  { id: 'reading', label: '正在阅读', icon: 'reading' },
  { id: 'lists', label: '书单', icon: 'lists' },
]

/** 非书架页的占位文案 */
const PLACEHOLDERS: Record<string, { title: string; hint: string }> = {
  reading: { title: '正在阅读', hint: '打开一本书后，它会显示在这里' },
  lists: { title: '书单', hint: '创建书单来整理你的藏书' },
  settings: { title: '设置', hint: '外观、存储与快捷键设置' },
}

export default function App() {
  const [theme, setTheme] = useState<Theme>('system')
  const [active, setActive] = useState('library')
  /** 书架数据（从 IndexedDB 读出） */
  const [books, setBooks] = useState<BookRecord[]>([])
  /** 拖拽文件悬停时的全屏提示 */
  const [dragOver, setDragOver] = useState(false)
  /** 隐藏的文件选择 input */
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 主题切换：写入 <html data-theme="...">，CSS 变量随之生效
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    // 原生窗口里隐藏 Web 版模拟交通灯，改用系统交通灯
    if ('__TAURI_INTERNALS__' in window) root.classList.add('tauri')
  }, [theme])

  // 首次挂载时加载书架
  useEffect(() => {
    getAllBooks().then(setBooks)
  }, [])

  /** 导入文件：逐个提取元数据 → 写入数据库 → 刷新书架 */
  const importFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList)
    for (const file of files) {
      try {
        const meta = await extractBookMeta(file)
        const record: BookRecord = {
          id: generateId(),
          title: meta.title,
          author: meta.author,
          format: meta.format,
          cover: meta.cover,
          file: file, // File 是 Blob 的子类，可直接入库存
          fileName: file.name,
          addedAt: Date.now(),
        }
        await addBook(record)
      } catch (err) {
        console.error('导入失败：', file.name, err)
      }
    }
    setBooks(await getAllBooks())
  }, [])

  // 全窗口拖拽导入：dragover 持续触发显示蒙层，drop 导入，dragleave（离开窗口）隐藏蒙层
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(true)
    }
    const onDragLeave = (e: DragEvent) => {
      // relatedTarget 为空说明指针已离开窗口，避免子元素间移动导致闪烁
      if (!e.relatedTarget) setDragOver(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (e.dataTransfer?.files.length) void importFiles(e.dataTransfer.files)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [importFiles])

  /** 删除一本书（带确认，防止误删整本书数据） */
  const handleDelete = useCallback(async (book: BookRecord) => {
    if (!window.confirm(`确定要从书架删除《${book.title}》吗？`)) return
    await deleteBook(book.id)
    setBooks(await getAllBooks())
  }, [])

  /** 点击书籍（功能②接入阅读器后生效） */
  const handleOpen = useCallback((book: BookRecord) => {
    console.log('打开书籍（待实现）：', book.title)
  }, [])

  const themeIcon: IconName = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'laptop'

  return (
    <div className="app">
      {/* 隐藏的文件选择器：accept 限制为支持的格式，multiple 支持一次选多本 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub,.txt,.pdf"
        multiple
        hidden
        onChange={e => {
          if (e.target.files?.length) void importFiles(e.target.files)
          // 清空 value，保证同一文件可以重复选择
          e.target.value = ''
        }}
      />

      <header className="titlebar" data-tauri-drag-region>
        <div className="traffic-lights" aria-hidden="true">
          <span className="dot close" />
          <span className="dot minimize" />
          <span className="dot maximize" />
        </div>
        <div className="titlebar-title">oread</div>
        <div className="toolbar">
          <button
            className="tool-btn"
            title="添加书籍 (Cmd+O)"
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="plus" />
          </button>
          <button className="tool-btn" title="搜索（开发中）">
            <Icon name="search" />
          </button>
          <span className="toolbar-separator" />
          <button
            className="tool-btn"
            title={`外观：${theme}（点击切换）`}
            onClick={() => setTheme(t => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'))}
          >
            <Icon name={themeIcon} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <nav className="sidebar-nav">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                className={`nav-item ${active === item.id ? 'active' : ''}`}
                onClick={() => setActive(item.id)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button
              className={`nav-item ${active === 'settings' ? 'active' : ''}`}
              onClick={() => setActive('settings')}
            >
              <Icon name="settings" />
              <span>设置</span>
            </button>
          </div>
        </aside>

        <main className="content">
          {active === 'library' ? (
            books.length > 0 ? (
              <Library books={books} onOpen={handleOpen} onDelete={handleDelete} />
            ) : (
              <div className="empty-state">
                <div className="empty-icon">
                  <Icon name="books" size={44} />
                </div>
                <h1>书架</h1>
                <p>把书籍拖到这里，或点击左上角的「添加」按钮</p>
              </div>
            )
          ) : (
            (() => {
              const current = PLACEHOLDERS[active] ?? PLACEHOLDERS.reading
              return (
                <div className="empty-state">
                  <h1>{current.title}</h1>
                  <p>{current.hint}</p>
                </div>
              )
            })()
          )}
        </main>
      </div>

      {/* 拖拽导入的全屏提示蒙层 */}
      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <Icon name="plus" size={28} />
            <span>松开以导入书籍</span>
          </div>
        </div>
      )}
    </div>
  )
}
