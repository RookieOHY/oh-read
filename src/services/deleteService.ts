/**
 * 删除服务 —— 软删除 + 撤销的完整管线
 *
 * 与 importService 对称：把"从书架移除一本书"的业务规则收口到这里。
 *
 * 关键顺序（曾出过数据损坏 bug，勿改）：
 *   先 getBook 拿完整记录（含文件本体）→ 取进度快照 → 再 deleteBook。
 *   若先删后取，getBook 必然返回 null，只能拿 BookMetaLite 拼一个空 Blob 兜底，
 *   撤销写回后书的文件本体就是 0 字节 —— 书彻底废了。
 *
 * 撤销时把完整记录与进度快照原样写回（进度按 hash 关联，删除时清掉的要补回来）。
 */

import type { BookMetaLite, BookRecord } from '../core/Book'
import { addBook, deleteBook, getBook } from '../core/Storage'
import { clearProgress, loadProgress, saveProgress, type ReadingProgress } from '../core/progress'

/** 一个待撤销的删除项：完整记录 + 删除前的进度快照 */
export interface PendingDelete {
  record: BookRecord
  progress: ReadingProgress | null
}

/**
 * 删除一本书，返回暂存项供上层放进撤销窗口。
 * 记录不存在时抛错（上层会显示"删除失败"），不执行删除。
 */
export async function removeBook(book: BookMetaLite): Promise<PendingDelete> {
  // ① 先取完整记录（含 file Blob / 封面）——删除后就来不及了
  const record = await getBook(book.id)
  if (!record) throw new Error(`书籍不存在：${book.id}`)
  // ② 进度快照（撤销时要恢复）
  const progress = loadProgress(book.hash)
  // ③ 真正删除 + 清理进度
  await deleteBook(book.id)
  clearProgress(book.hash)
  return { record, progress }
}

/**
 * 撤销删除：把暂存的记录与进度写回库中。
 * 由上层负责清空暂存数组（这里只负责写回）。
 */
export async function restoreBooks(items: PendingDelete[]): Promise<void> {
  for (const { record, progress } of items) {
    await addBook(record)
    if (progress) saveProgress(record.hash, progress)
  }
}
