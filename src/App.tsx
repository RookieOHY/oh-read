/**
 * 应用外壳 + 书架页
 *
 * 结构：
 *   标题栏（原生交通灯 + 侧边栏切换 + 工具按钮）
 *   侧边栏（书架 / 正在阅读 / 书单 / 设置）
 *   主内容区（书架网格 或 各页占位）
 *   阅读视图（readingBook 非空时覆盖整个工作区）
 *
 * 导入途径：
 *   1. 工具栏「添加」按钮 → 系统文件选择器
 *   2. 把文件直接拖进窗口（任意位置）
 *
 * 数据流：
 *   书架列表 = listBooks() 的轻量投影（不含文件 Blob）；
 *   点开书 = getBook(id) 取完整记录 → 进入阅读视图。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookMetaLite, BookRecord } from './core/Book'
import { addBook, deleteBook, getBook, listBooks } from './core/Storage'
import { clearProgress } from './core/progress'
import { formatError } from './core/errors'
import { importFiles, summarizeImport, type ImportResult } from './services/importService'
import Library from './components/Library'
import ReaderView from './components/Reader/ReaderView'
import Toast, { toastDuration, type ToastState } from './components/Toast'
import { Icon } from './components/Icons'

type Theme = 'system' | 'light' | 'dark'

const NAV_ITEMS: { id: string; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
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
  /** 书架数据（listBooks 的轻量投影，不含文件 Blob） */
  const [books, setBooks] = useState<BookMetaLite[]>([])
  /** 拖拽文件悬停时的全屏提示 */
  const [dragOver, setDragOver] = useState(false)
  /**
   * 侧边栏开合状态：默认收起（首次启动只有标题栏 + 内容区），
   * 用户切换后写入 localStorage 记住偏好。
   */
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(
    () => localStorage.getItem('oread.sidebarOpen') === 'true',
  )
  /** 底部轻量提示（info=导入汇总 3 秒 / undo=删除撤销 8 秒） */
  const [toast, setToast] = useState<ToastState | null>(null)
  /**
   * 当前正在阅读的书（完整记录，含文件本体；进入阅读时按 id 从库里取）。
   * 方案 B（独立原生窗口）的替换点见 core/readerLauncher.ts。
   */
  const [readingBook, setReadingBook] = useState<BookRecord | null>(null)
  /**
   * 软删除暂存区：被删除的书籍记录暂存（与 undo toast 同生命周期）。
   * 记录已从数据库移除，撤销窗口内若不恢复，超时后 Blob 由垃圾回收，
   * 数据彻底丢失（内存优先：暂存的是引用，不留副本）。
   */
  const pendingDeleteRef = useRef<BookRecord[]>([])
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
    listBooks().then(setBooks)
  }, [])

  // toast 自动消失：undo 与导入提示的驻留时长不同（见 toastDuration）；
  // 超时同时放弃撤销窗口（软删除的记录此时真正丢弃）
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => {
      pendingDeleteRef.current = []
      setToast(null)
    }, toastDuration(toast))
    return () => clearTimeout(timer)
  }, [toast])

  /** 导入文件（管线见 importService）：完成后刷新书架并汇总结果 */
  const handleImport = useCallback(async (fileList: FileList | File[]) => {
    const result: ImportResult = await importFiles(fileList)
    setBooks(await listBooks())
    const text = summarizeImport(result)
    // 有失败时归入 info 语义（无撤销），否则与之前一致
    setToast({ kind: 'info', text })
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
      if (e.dataTransfer?.files.length) void handleImport(e.dataTransfer.files)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [handleImport])

  /**
   * 软删除一本书：从库中移除 + 暂存待撤销（不弹确认框，误删可撤销找回）。
   * 同时清理该书的阅读进度（按 hash 关联）。
   */
  const handleDelete = useCallback((book: BookMetaLite) => {
    void (async () => {
      try {
        await deleteBook(book.id)
        pendingDeleteRef.current.push(await getBook(book.id).then(r => r ?? { ...book, file: new Blob() }))
        const count = pendingDeleteRef.current.length
        clearProgress(book.hash)
        setBooks(await listBooks())
        // 连续删除多本时批量表述；toast 显示撤销按钮
        setToast({
          kind: 'undo',
          text: count > 1 ? `已删除 ${count} 本` : `已删除《${book.title}》`,
        })
      } catch (err) {
        // 失败原因直接显示出来，方便定位
        console.error('删除失败：', err)
        setToast({ kind: 'info', text: `删除失败：${formatError(err)}` })
      }
    })()
  }, [])

  /** 撤销删除：把暂存的记录原样写回数据库（id/进度/封面全部保留） */
  const handleUndoDelete = useCallback(() => {
    void (async () => {
      try {
        const pending = pendingDeleteRef.current
        pendingDeleteRef.current = []
        for (const record of pending) await addBook(record)
        setBooks(await listBooks())
        setToast(null)
      } catch (err) {
        console.error('撤销失败：', err)
        setToast({ kind: 'info', text: `撤销失败：${formatError(err)}` })
      }
    })()
  }, [])

  /** 点击书籍：取完整记录后进入阅读视图（方案 A 入口；方案 B 见 core/readerLauncher.ts） */
  const handleOpen = useCallback(async (book: BookMetaLite) => {
    const record = await getBook(book.id)
    if (!record) {
      // 极端场景：书架列表与库不同步（如数据被手动清掉）
      setToast({ kind: 'info', text: `无法打开《${book.title}》，书籍数据不存在` })
      setBooks(await listBooks())
      return
    }
    setReadingBook(record)
  }, [])

  /** 退出阅读视图，回到书架 */
  const closeReader = useCallback(() => {
    setReadingBook(null)
  }, [])

  /** 切换侧边栏并记住偏好 */
  const toggleSidebar = useCallback(() => {
    setSidebarOpen(open => {
      localStorage.setItem('oread.sidebarOpen', String(!open))
      return !open
    })
  }, [])

  const themeIcon: Parameters<typeof Icon>[0]['name'] =
    theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'laptop'

  return (
    <div className="app">
      {/* 隐藏的文件选择器：accept 与实际支持的格式一致，multiple 支持一次选多本 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub,.txt,.cbz"
        multiple
        hidden
        onChange={e => {
          if (e.target.files?.length) void handleImport(e.target.files)
          // 清空 value，保证同一文件可以重复选择
          e.target.value = ''
        }}
      />

      <header className="titlebar" data-tauri-drag-region>
        <div className="traffic-lights" data-tauri-drag-region aria-hidden="true">
          <span className="dot close" />
          <span className="dot minimize" />
          <span className="dot maximize" />
        </div>
        {/* 侧边栏切换按钮：macOS 惯例放在标题栏最左侧（交通灯之后） */}
        <div className="toolbar-left">
          <button
            className={`tool-btn ${sidebarOpen ? 'active' : ''}`}
            title={sidebarOpen ? '隐藏侧边栏' : '显示侧边栏'}
            aria-label={sidebarOpen ? '隐藏侧边栏' : '显示侧边栏'}
            onClick={toggleSidebar}
          >
            <Icon name="sidebar" />
          </button>
        </div>
        <div className="titlebar-title" data-tauri-drag-region>oread</div>
        <div className="toolbar">
          <button
            className="tool-btn"
            title="添加书籍 (Cmd+O)"
            aria-label="添加书籍"
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="plus" />
          </button>
          <button className="tool-btn" title="搜索（开发中）" aria-label="搜索">
            <Icon name="search" />
          </button>
          <span className="toolbar-separator" />
          <button
            className="tool-btn"
            title={`外观：${theme}（点击切换）`}
            aria-label="切换外观主题"
            onClick={() => setTheme(t => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'))}
          >
            <Icon name={themeIcon} />
          </button>
        </div>
      </header>

      {/* 阅读视图：覆盖整个工作区（保留原生标题栏/交通灯） */}
      {readingBook ? (
        <ReaderView book={readingBook} onBack={closeReader} />
      ) : (
        <div className={`workspace ${sidebarOpen ? '' : 'no-sidebar'}`}>
          <aside className="sidebar">
            <nav className="sidebar-nav" aria-label="主导航">
              {NAV_ITEMS.map(item => (
                <button
                  key={item.id}
                  className={`nav-item ${active === item.id ? 'active' : ''}`}
                  aria-current={active === item.id ? 'page' : undefined}
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
                aria-current={active === 'settings' ? 'page' : undefined}
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
      )}

      {/* 拖拽导入的全屏提示蒙层 */}
      {dragOver && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <Icon name="plus" size={28} />
            <span>松开以导入书籍</span>
          </div>
        </div>
      )}

      {/* 底部轻量提示（导入汇总 / 删除撤销，见 Toast 组件） */}
      <Toast toast={toast} onUndo={handleUndoDelete} />
    </div>
  )
}
