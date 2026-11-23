/**
 * 目录树（抽屉内容）
 *
 * 数据源：foliate-js 的 book.toc，条目结构 { label, href, subitems }。
 * 参照 foliate 官方 ui/tree.js 与 Readest 的 TOCView：
 * - 层级用 subitems 递归，展开状态用 Set 记录（按路径做 key，避免重复 href 冲突）
 * - 当前章节由 relocate 事件的 tocItem.href 驱动，高亮 + 展开祖先 + 滚动居中
 * - 用 react-virtuoso 虚拟列表：长目录（网络小说可达数千章）只渲染可视行，
 *   避免 foliate issue #386 那种打开目录卡死
 * - 键盘：WAI-ARIA tree 模式，单 Tab 停留点 + 方向键移动焦点
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { FoliateTocItem } from '../../types/foliate'

interface Props {
  toc: FoliateTocItem[]
  /** 当前章节的 href（来自 relocate 的 tocItem.href），null 表示尚未定位 */
  currentHref: string | null
  /** 点击目录项：ReaderView 调 view.goTo(href) */
  onNavigate: (href: string) => void
}

/** 展平后的一行目录 */
interface Row {
  item: FoliateTocItem
  /** 展开状态/祖先定位用的稳定 key（路径，避免重复 href） */
  key: string
  depth: number
  hasChildren: boolean
  expanded: boolean
}

/** 递归展平：只把已展开节点的子项放进行列表 */
function flatten(items: FoliateTocItem[], expanded: Set<string>, depth = 0, prefix = ''): Row[] {
  const rows: Row[] = []
  items.forEach((item, i) => {
    const key = `${prefix}/${i}`
    const hasChildren = !!item.subitems?.length
    const isExpanded = expanded.has(key)
    rows.push({ item, key, depth, hasChildren, expanded: isExpanded })
    if (hasChildren && isExpanded) {
      rows.push(...flatten(item.subitems!, expanded, depth + 1, key))
    }
  })
  return rows
}

/** 建 href → 祖先 key 列表的映射，用于定位当前项时自动展开 */
function buildAncestorMap(items: FoliateTocItem[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const walk = (list: FoliateTocItem[], prefix: string, ancestors: string[]) => {
    list.forEach((item, i) => {
      const key = `${prefix}/${i}`
      if (item.href) map.set(item.href, ancestors)
      if (item.subitems?.length) walk(item.subitems, key, [...ancestors, key])
    })
  }
  walk(items, '', [])
  return map
}

export default function TocView({ toc, currentHref, onNavigate }: Props) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  /** 键盘焦点所在行（aria-activedescendant 跟随它） */
  const [focusIndex, setFocusIndex] = useState(0)

  const ancestorMap = useMemo(() => buildAncestorMap(toc), [toc])
  // 当前章节的祖先永远展开（derived，不用 effect 写 state——避免级联渲染）：
  // 与 foliate 官方一致，当前章节路径始终可见；用户仍可折叠其他分支。
  const effectiveExpanded = useMemo(() => {
    const ancestors = currentHref ? ancestorMap.get(currentHref) : null
    if (!ancestors?.length) return expanded
    const next = new Set(expanded)
    ancestors.forEach(k => next.add(k))
    return next
  }, [expanded, currentHref, ancestorMap])
  const rows = useMemo(() => flatten(toc, effectiveExpanded), [toc, effectiveExpanded])

  const currentIndex = rows.findIndex(r => r.item.href === currentHref)

  // 定位到当前章节：目录首次拿到 currentHref 或章节切换时滚动居中
  useEffect(() => {
    if (currentIndex < 0) return
    virtuosoRef.current?.scrollToIndex({ index: currentIndex, align: 'center' })
    // 微任务里更新焦点，避开 effect 内同步 setState 的级联渲染告警
    queueMicrotask(() => setFocusIndex(currentIndex))
  }, [currentIndex])

  const toggle = useCallback(
    (key: string) => {
      // 基于当前"实际展开集合"翻转：若收起的是当前章节的祖先，
      // 它会从 expanded 中移除但 derived 集合仍展开（保持当前章节可见）。
      setExpanded(new Set(effectiveExpanded.has(key)
        ? [...effectiveExpanded].filter(k => k !== key)
        : [...effectiveExpanded, key]))
    },
    [effectiveExpanded],
  )

  /** WAI-ARIA tree 键盘导航：只认容器上的按键，统一处理翻页键（阻止冒泡到阅读器） */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next = focusIndex
    switch (e.key) {
      case 'ArrowDown': next = Math.min(rows.length - 1, focusIndex + 1); break
      case 'ArrowUp': next = Math.max(0, focusIndex - 1); break
      case 'Home': next = 0; break
      case 'End': next = rows.length - 1; break
      case 'ArrowLeft': {
        const row = rows[focusIndex]
        if (row?.hasChildren && row.expanded) toggle(row.key)
        else if (row) {
          // 跳回父节点：找最近一个 depth 更小且排在前方的行
          for (let i = focusIndex - 1; i >= 0; i--) {
            if (rows[i].depth < row.depth) { next = i; break }
          }
        }
        break
      }
      case 'ArrowRight': {
        const row = rows[focusIndex]
        if (row?.hasChildren && !row.expanded) toggle(row.key)
        else if (row?.hasChildren) next = Math.min(rows.length - 1, focusIndex + 1)
        break
      }
      case 'Enter':
      case ' ': {
        const row = rows[focusIndex]
        if (row) {
          if (row.hasChildren) toggle(row.key)
          else if (row.item.href) onNavigate(row.item.href)
        }
        break
      }
      default: return
    }
    e.preventDefault()
    e.stopPropagation()
    if (next !== focusIndex) {
      setFocusIndex(next)
      virtuosoRef.current?.scrollToIndex({ index: next, align: 'center' })
    }
  }

  if (!toc.length) {
    return <div className="toc-empty">这本书没有目录</div>
  }

  return (
    <div
      className="toc-list"
      ref={listRef}
      role="tree"
      aria-label="目录"
      aria-activedescendant={`toc-row-${focusIndex}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <Virtuoso
        ref={virtuosoRef}
        totalCount={rows.length}
        overscan={20}
        itemContent={index => {
          const row = rows[index]
          const isCurrent = row.item.href === currentHref
          return (
            <div
              id={`toc-row-${index}`}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-expanded={row.hasChildren ? row.expanded : undefined}
              aria-current={isCurrent ? 'page' : undefined}
              aria-selected={index === focusIndex}
              className={`toc-row ${isCurrent ? 'current' : ''} ${index === focusIndex ? 'focused' : ''}`}
              style={{ paddingLeft: `${(row.depth + 1) * 16}px` }}
              onClick={() => {
                if (row.hasChildren) toggle(row.key)
                else if (row.item.href) onNavigate(row.item.href)
                setFocusIndex(index)
              }}
            >
              {row.hasChildren && (
                <span className="toc-expander" aria-hidden="true">{row.expanded ? '▾' : '▸'}</span>
              )}
              <span className="toc-label">{row.item.label}</span>
            </div>
          )
        }}
      />
    </div>
  )
}
