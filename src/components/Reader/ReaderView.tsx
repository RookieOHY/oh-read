/**
 * 阅读视图（方案 A：当前窗口内的全屏阅读页）
 *
 * 组成：
 *   - foliate-js 的 <foliate-view> 自定义元素负责解析与渲染书籍（EPUB/CBZ 等）
 *   - 顶部细条工具栏：返回书架 + 书名 + 进度百分比
 *   - relocate 事件 → 节流保存阅读进度；打开时按进度恢复定位
 *
 * foliate-js 是无类型的纯 JS 库（MIT），以源码 vendor 引入，
 * 关键 API：open(file) / close() / goToFraction(全书比例) / getSectionFractions()
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookRecord } from '../../core/Book'
import { detectFormat } from '../../providers/epubMeta'
import { loadProgress, saveProgress, type ReadingProgress } from '../../core/progress'

interface Props {
  book: BookRecord
  /** 返回书架（由 App 提供的 closeReader） */
  onBack: () => void
}

export default function ReaderView({ book, onBack }: Props) {
  /** foliate-view 元素的挂载容器 */
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<any>(null)
  /** 当前书是否已打开完成（用于淡入，避免闪白） */
  const [ready, setReady] = useState(false)
  /** 打开失败的提示（例如文件损坏） */
  const [error, setError] = useState<string | null>(null)
  /** 工具栏显示的进度（全书百分比） */
  const [percent, setPercent] = useState(0)
  /** 进度写入节流：阅读时 relocate 每页都触发，3 秒最多写一次 */
  const lastSaveRef = useRef(0)
  /** 最近一次 relocate 的进度快照（返回书架时补写用，避免节流丢进度） */
  const lastDetailRef = useRef<{ index: number; fraction: number; overall: number } | null>(null)
  /** 当前书的 foliate book 对象（TXT 有 dispose 逻辑，卸载时统一释放 blob URL） */
  const bookObjRef = useRef<any>(null)

  // 打开书籍：组件挂载 / 书籍切换时执行
  useEffect(() => {
    let cancelled = false
    let view: any = null
    // 翻页键处理：主文档与章节 iframe 文档共用同一个处理器
    //（定义在 effect 作用域，保证 cleanup 可以正确解绑）
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'h') view?.goLeft()
      else if (e.key === 'ArrowRight' || e.key === 'l') view?.goRight()
    }

    void (async () => {
      try {
        // 动态加载 foliate-js：只在真正阅读时才下载这段代码（启动速度优先）
        // @ts-expect-error —— foliate-js 为无类型纯 JS 库
        await import('../../vendor/foliate-js/view.js')
        if (cancelled || !containerRef.current) return

        view = document.createElement('foliate-view')
        viewRef.current = view

        // relocate = 阅读位置变化：换算全书比例并节流保存
        view.addEventListener('relocate', (e: any) => {
          if (cancelled) return
          const { index, fraction } = e.detail
          // 章节权重表（打开后可用）：把"章内比例"换算成"全书比例"
          const sections: number[] = view.getSectionFractions?.() ?? []
          const start = sections[index] ?? 0
          const end = sections[index + 1] ?? 1
          const overall = Math.min(1, start + (end - start) * (fraction ?? 0))
          setPercent(Math.round(overall * 100))
          // 记录最近一次位置快照（返回书架时无条件补写）
          lastDetailRef.current = { index, fraction: fraction ?? 0, overall }

          // 节流：3 秒最多落盘一次（用内存时间戳判断，避免高频读 localStorage）；
          // 返回书架时由 handleBack 用快照补写最后一次
          const now = Date.now()
          if (now - lastSaveRef.current > 3000) {
            lastSaveRef.current = now
            saveProgress(book.hash, { index, fraction, overall, updatedAt: now })
          }
        })

        containerRef.current.appendChild(view)

        // TXT / 网络小说：foliate-js 不自带 TXT 解析，走我们自己的
        // TextProvider 构建 book 对象（章节切分 + book 接口适配）
        const format = detectFormat(book.fileName)
        if (format === 'txt') {
          const { buildTxtBook } = await import('../../providers/TextProvider')
          const txtBook = await buildTxtBook(book.file, book.hash, book.title)
          if (cancelled) return
          await view.open(txtBook)
          bookObjRef.current = txtBook
          // TXT 用滚动模式：中文长文滚动阅读是主流习惯（参考 Legado/微信读书），
          // 且避开分页模式在"章节内容不足一页"时的末页定位边界问题
          view.renderer?.setAttribute?.('flow', 'scrolled')
        } else {
          // EPUB / CBZ 等：直接把 Blob 交给 foliate-js 自动识别
          await view.open(book.file)
        }

        // 翻页交互（参考官方 demo reader.js）：
        // 主文档绑定一次；每个章节文档加载完成时（load 事件）同样绑定——
        // 因为点击书页后键盘焦点会移进 iframe
        window.addEventListener('keydown', onKey)
        view.addEventListener('load', (e: any) => {
          e.detail?.doc?.addEventListener?.('keydown', onKey)
        })

        // 进度恢复：有记录 → 跳到全书比例位置；新书 → 从头
        // （进度按内容指纹 hash 关联，删除重导也能找回）
        const saved: ReadingProgress | null = loadProgress(book.hash)
        if (saved && Number.isFinite(saved.overall)) {
          await view.goToFraction(saved.overall)
          setPercent(Math.round(saved.overall * 100))
        } else {
          await view.goTo(0)
        }
        if (!cancelled) {
          setReady(true)
          // 焦点移入书页容器：屏幕阅读器能感知进入阅读视图，
          // 键盘用户无需 Tab 穿越整个工具栏
          containerRef.current?.focus()
        }
      } catch (err) {
        console.error('打开书籍失败：', err)
        if (!cancelled) setError(String(err))
      }
    })()

    // 卸载：解绑按键、销毁渲染器并移除 DOM 元素，避免内存驻留（内存优先约束）
    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKey)
      try {
        // TXT 的 book 对象带有 dispose（revoke 全部章节 blob URL）——
        // 放在 close 之前，确保渲染器持有过的 URL 都被释放
        bookObjRef.current?.dispose?.()
        view?.close()
        view?.remove()
      } catch {
        // 忽略关闭异常
      }
      bookObjRef.current = null
      viewRef.current = null
    }
  }, [book.id])

  /** 返回书架：先把当前进度补写一次再退出（退出不丢进度） */
  const handleBack = useCallback(() => {
    // 节流可能吞掉最后几页的进度：用最近一次 relocate 快照无条件补写
    const snapshot = lastDetailRef.current
    if (snapshot) {
      saveProgress(book.hash, {
        index: snapshot.index,
        fraction: snapshot.fraction,
        overall: snapshot.overall,
        updatedAt: Date.now(),
      })
    }
    onBack()
  }, [book.hash, onBack])

  return (
    <div className={`reader ${ready ? 'ready' : ''}`}>
      {/* 顶部细条工具栏 */}
      <header className="reader-bar">
        <button className="tool-btn" title="返回书架" onClick={handleBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <span className="reader-title">{book.title}</span>
        <span className="reader-percent">{percent}%</span>
      </header>

      {/* 书页渲染区：foliate-view 挂载点（tabable，便于焦点管理） */}
      <div className="reader-stage" ref={containerRef} tabIndex={-1} />

      {/* 打开中的遮罩（淡入完成前） */}
      {!ready && !error && (
        <div className="reader-loading">
          <span>正在打开「{book.title}」…</span>
        </div>
      )}
      {error && (
        <div className="reader-loading">
          <span>打开失败：{error}</span>
          <button className="toast-action" onClick={onBack}>返回书架</button>
        </div>
      )}
    </div>
  )
}
