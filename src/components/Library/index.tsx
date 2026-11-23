/**
 * 书架组件：网格展示书籍封面、书名、作者、阅读进度
 *
 * 交互：
 * - 左键点击 / Enter / 空格 → 打开书籍（切换到阅读视图）
 * - 右键卡片 → 上下文菜单（从书架移除）——符合 macOS 习惯
 * - hover 卡片 → 浮现 × 删除按钮
 * - 已读的书在书名右侧显示进度百分比（阅读视图返回时刷新）
 *
 * 数据类型：BookMetaLite（不含文件本体的轻量投影），
 * 完整记录由 App 在打开书籍时按 id 单独获取。
 *
 * 内存注意：封面 Blob 通过 object URL 渲染，组件卸载时必须 revoke，
 * 否则位图会一直驻留内存（内存优先约束）。
 */

import { useEffect, useRef, useState } from 'react'
import type { BookMetaLite } from '../../core/Book'
import { loadAllProgress } from '../../core/progress'

interface Props {
  books: BookMetaLite[]
  /** 点击一本书（App 侧取完整记录后切换到阅读视图） */
  onOpen: (book: BookMetaLite) => void
  /** 删除一本书（App 层做软删除，这里只负责发起） */
  onDelete: (book: BookMetaLite) => void
}

/** 单本书卡片：负责封面 object URL 的创建与释放 */
function BookCard({
  book,
  progress,
  onOpen,
  onDelete,
  onContextMenu,
}: {
  book: BookMetaLite
  /** 全书阅读比例 0~1（undefined 表示从未打开过，不显示进度） */
  progress?: number
  onOpen: (book: BookMetaLite) => void
  onDelete: (book: BookMetaLite) => void
  onContextMenu: (e: React.MouseEvent, book: BookMetaLite) => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  /** 当前生效的封面 URL（onError 用它区分"旧 URL 被 revoke"与"真解码失败"） */
  const currentUrlRef = useRef<string | null>(null)
  /** 封面解码失败时退回文字封面，避免破图问号 */
  const [coverFailed, setCoverFailed] = useState(false)

  // 封面 URL 直接在 effect 里写到 DOM 节点上（而不是经 React state 传给 <img src>）：
  // StrictMode 会跑「挂载→清理→再挂载」，若 URL 经 state 传递，第一次清理 revoke 掉的
  // URL 可能恰好被 React 提交给 <img>，浏览器拿到失效 URL 就一直停在"未加载"状态
  // （破图问号）。这里每次 setup 都重新 createObjectURL 并直接赋给 img.src，
  // 保证 <img> 最终拿到的一定是有效 URL；cleanup 再释放。
  useEffect(() => {
    if (!book.cover || !imgRef.current) return
    const url = URL.createObjectURL(book.cover)
    currentUrlRef.current = url
    imgRef.current.src = url
    // 卸载或封面变化时释放 object URL（内存优先约束：位图不驻留）
    return () => {
      URL.revokeObjectURL(url)
      if (currentUrlRef.current === url) currentUrlRef.current = null
    }
  }, [book.cover])

  // 无封面时用书名首字生成占位封面
  const initial = book.title.charAt(0).toUpperCase()

  return (
    // 卡片用 role="button" 而不是 <button>：内部还有删除子按钮，
    // 嵌套 button 不合法（HTML 规范）；键盘 Enter/空格手动实现
    <div
      className="book-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(book)}
      onContextMenu={e => onContextMenu(e, book)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(book)
        }
      }}
      title={book.title}
      aria-label={`打开《${book.title}》`}
    >
      <div className="book-cover">
        {book.cover && !coverFailed ? (
          <img
            ref={imgRef}
            alt={book.title}
            loading="lazy"
            onError={() => {
              // StrictMode 清理阶段 revoke 旧 URL 也会触发 error（此时 src 已换成新 URL），
              // 忽略这类"过期错误"，只对当前生效 URL 的失败降级。
              const img = imgRef.current
              if (!img || (currentUrlRef.current && img.src !== currentUrlRef.current)) return
              console.warn(`封面加载失败：《${book.title}》，改用文字封面`)
              setCoverFailed(true)
            }}
          />
        ) : (
          <div className="book-cover-fallback" aria-hidden="true">{initial}</div>
        )}
        {/* 阻止点击冒泡到卡片，避免误触「打开」 */}
        <button
          className="book-delete"
          title="从书架移除"
          aria-label={`从书架移除《${book.title}》`}
          onClick={e => {
            e.stopPropagation()
            onDelete(book)
          }}
        >
          ×
        </button>
      </div>
      {/* 书名行：左侧书名，右侧阅读进度（已打开过且不在开头时显示） */}
      <div className="book-title-row">
        <div className="book-title">{book.title}</div>
        {progress != null && progress > 0.001 && (
          <span className="book-progress">{Math.round(progress * 100)}%</span>
        )}
      </div>
      {book.author && <div className="book-author">{book.author}</div>}
    </div>
  )
}

export default function Library({ books, onOpen, onDelete }: Props) {
  /** 右键菜单状态：定位坐标 + 目标书籍；null 表示菜单关闭 */
  const [menu, setMenu] = useState<{ x: number; y: number; book: BookMetaLite } | null>(null)
  /**
   * 进度映射：hash → 全书比例。
   * 用惰性初始化（挂载时读一次）而非 effect——从阅读视图返回书架时
   * Library 会重新挂载，initializer 自然重跑，进度自动刷新。
   */
  const [progressMap] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    for (const p of loadAllProgress()) map[p.hash] = p.overall
    return map
  })

  // 菜单打开期间：点击任意位置 / 改变窗口大小 / 按 Esc 都会关闭
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <div className="shelf" role="grid" aria-label="书架">
      <div className="shelf-grid">
        {books.map(book => (
          <BookCard
            key={book.id}
            book={book}
            progress={progressMap[book.hash]}
            onOpen={onOpen}
            onDelete={onDelete}
            onContextMenu={(e, target) => {
              // 阻止浏览器默认菜单，改用自定义上下文菜单
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, book: target })
            }}
          />
        ))}
      </div>

      {/* 右键上下文菜单（macOS 风格：毛玻璃 + 蓝色高亮） */}
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <button
            onClick={() => {
              onDelete(menu.book)
              setMenu(null)
            }}
          >
            从书架移除
          </button>
        </div>
      )}
    </div>
  )
}
