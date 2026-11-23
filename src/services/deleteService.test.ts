/**
 * 删除/撤销服务测试
 *
 * 重点覆盖曾造成数据损坏的 bug：必须先取完整记录再删除，
 * 撤销写回时 file Blob 与进度都要原样恢复。
 * 用 vi.mock 隔离 IndexedDB/localStorage，专注业务逻辑。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { BookMetaLite, BookRecord } from '../core/Book'
import type { ReadingProgress } from '../core/progress'

vi.mock('../core/Storage', () => ({
  getBook: vi.fn(),
  deleteBook: vi.fn(),
  addBook: vi.fn(),
}))
vi.mock('../core/progress', () => ({
  loadProgress: vi.fn(),
  saveProgress: vi.fn(),
  clearProgress: vi.fn(),
}))

import { getBook, deleteBook, addBook } from '../core/Storage'
import { loadProgress, saveProgress, clearProgress } from '../core/progress'
import { removeBook, restoreBooks } from './deleteService'

const FILE_BLOB = new Blob(['完整书籍内容'])
const RECORD: BookRecord = {
  id: 'book-1',
  hash: 'hash-1',
  title: '测试书',
  author: '作者',
  format: 'txt',
  cover: new Blob(['封面']),
  file: FILE_BLOB,
  fileName: '测试书.txt',
  addedAt: 1234,
}
const LITE: BookMetaLite = {
  id: RECORD.id,
  hash: RECORD.hash,
  title: RECORD.title,
  author: RECORD.author,
  format: RECORD.format,
  cover: RECORD.cover,
  fileName: RECORD.fileName,
  addedAt: RECORD.addedAt,
}
const PROGRESS: ReadingProgress = { index: 3, fraction: 0.5, overall: 0.42, updatedAt: 999 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBook).mockResolvedValue(RECORD)
  vi.mocked(loadProgress).mockReturnValue(PROGRESS)
})

describe('removeBook', () => {
  it('先取完整记录再删除，返回含 file Blob 的暂存项', async () => {
    const pending = await removeBook(LITE)
    // 顺序：getBook 必须在 deleteBook 之前（否则拿到空壳 → 数据损坏）
    expect(getBook).toHaveBeenCalledWith('book-1')
    expect(deleteBook).toHaveBeenCalledWith('book-1')
    expect(vi.mocked(getBook).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deleteBook).mock.invocationCallOrder[0],
    )
    // 暂存的是完整记录，文件本体必须是原始 Blob（而不是空 Blob）
    expect(pending.record.file).toBe(FILE_BLOB)
    expect(pending.record).toEqual(RECORD)
  })

  it('删除时清理进度，但保留进度快照供撤销恢复', async () => {
    const pending = await removeBook(LITE)
    expect(clearProgress).toHaveBeenCalledWith('hash-1')
    expect(pending.progress).toEqual(PROGRESS)
  })

  it('记录不存在时抛错且不执行删除', async () => {
    vi.mocked(getBook).mockResolvedValue(null)
    await expect(removeBook(LITE)).rejects.toThrow('书籍不存在')
    expect(deleteBook).not.toHaveBeenCalled()
  })
})

describe('restoreBooks', () => {
  it('撤销后把完整记录与进度都写回', async () => {
    const pending = await removeBook(LITE)
    await restoreBooks([pending])
    expect(addBook).toHaveBeenCalledWith(RECORD)
    expect(saveProgress).toHaveBeenCalledWith('hash-1', PROGRESS)
  })

  it('无进度快照时不写回进度（新书撤销场景）', async () => {
    vi.mocked(loadProgress).mockReturnValue(null)
    const pending = await removeBook(LITE)
    await restoreBooks([pending])
    expect(addBook).toHaveBeenCalledWith(RECORD)
    expect(saveProgress).not.toHaveBeenCalled()
  })

  it('批量撤销：多本书逐条恢复', async () => {
    const second = { ...RECORD, id: 'book-2', hash: 'hash-2' }
    vi.mocked(getBook).mockResolvedValueOnce(RECORD).mockResolvedValueOnce(second)
    const a = await removeBook(LITE)
    const b = await removeBook({ ...LITE, id: 'book-2', hash: 'hash-2' })
    await restoreBooks([a, b])
    expect(addBook).toHaveBeenCalledTimes(2)
    expect(addBook).toHaveBeenNthCalledWith(1, RECORD)
    expect(addBook).toHaveBeenNthCalledWith(2, second)
  })
})
