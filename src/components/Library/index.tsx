/**
 * 书架组件：网格展示书籍封面、书名、作者
 *
 * 内存注意：封面 Blob 通过 object URL 渲染，组件卸载时必须 revoke，
 * 否则位图会一直驻留内存（内存优先约束）。
 */

import { useEffect, useState } from 'react'
import type { BookRecord } from '../../core/Book'

interface Props {
  books: BookRecord[]
  /** 点击一本书（功能②接入阅读后生效，目前是占位） */
  onOpen: (book: BookRecord) => void
  /** 删除一本书 */
  onDelete: (book: BookRecord) => void
}

/** 单本书卡片：负责封面 object URL 的创建与释放 */
function BookCard({
  book,
  onOpen,
  onDelete,
}: {
  book: BookRecord
  onOpen: (book: BookRecord) => void
  onDelete: (book: BookRecord) => void
}) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!book.cover) return
    const url = URL.createObjectURL(book.cover)
    setCoverUrl(url)
    // 卸载或封面变化时释放 object URL
    return () => URL.revokeObjectURL(url)
  }, [book.cover])

  // 无封面时用书名首字生成占位封面
  const initial = book.title.charAt(0).toUpperCase()

  return (
    <div className="book-card" onClick={() => onOpen(book)} title={book.title}>
      <div className="book-cover">
        {coverUrl ? (
          <img src={coverUrl} alt={book.title} loading="lazy" />
        ) : (
          <div className="book-cover-fallback">{initial}</div>
        )}
        {/* 阻止点击冒泡到卡片，避免误触「打开」 */}
        <button
          className="book-delete"
          title="从书架删除"
          onClick={e => {
            e.stopPropagation()
            onDelete(book)
          }}
        >
          ×
        </button>
      </div>
      <div className="book-title">{book.title}</div>
      {book.author && <div className="book-author">{book.author}</div>}
    </div>
  )
}

export default function Library({ books, onOpen, onDelete }: Props) {
  return (
    <div className="shelf">
      <div className="shelf-grid">
        {books.map(book => (
          <BookCard key={book.id} book={book} onOpen={onOpen} onDelete={onDelete} />
        ))}
      </div>
    </div>
  )
}
