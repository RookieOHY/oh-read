import { useEffect, useState, type ReactNode } from 'react'

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

const PLACEHOLDERS: Record<string, { title: string; hint: string }> = {
  library: { title: '书架', hint: '把书籍拖到这里，或点击左上角的「添加」按钮' },
  reading: { title: '正在阅读', hint: '打开一本书后，它会显示在这里' },
  lists: { title: '书单', hint: '创建书单来整理你的藏书' },
  settings: { title: '设置', hint: '外观、存储与快捷键设置' },
}

export default function App() {
  const [theme, setTheme] = useState<Theme>('system')
  const [active, setActive] = useState('library')

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    if ('__TAURI_INTERNALS__' in window) root.classList.add('tauri')
  }, [theme])

  const cycleTheme = () => {
    setTheme(t => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'))
  }

  const themeIcon: IconName = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'laptop'
  const current = PLACEHOLDERS[active] ?? PLACEHOLDERS.library

  return (
    <div className="app">
      <header className="titlebar" data-tauri-drag-region>
        <div className="traffic-lights" aria-hidden="true">
          <span className="dot close" />
          <span className="dot minimize" />
          <span className="dot maximize" />
        </div>
        <div className="titlebar-title">oread</div>
        <div className="toolbar">
          <button className="tool-btn" title="添加书籍 (Cmd+O)">
            <Icon name="plus" />
          </button>
          <button className="tool-btn" title="搜索 (Cmd+F)">
            <Icon name="search" />
          </button>
          <span className="toolbar-separator" />
          <button
            className="tool-btn"
            title={`外观：${theme}（点击切换）`}
            onClick={cycleTheme}
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
          <div className="empty-state">
            <div className="empty-icon">
              <Icon name="books" size={44} />
            </div>
            <h1>{current.title}</h1>
            <p>{current.hint}</p>
          </div>
        </main>
      </div>
    </div>
  )
}
