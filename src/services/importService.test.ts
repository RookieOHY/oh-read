/**
 * 导入服务测试
 *
 * 重点覆盖曾存在的并发去重竞态：
 *   两本内容相同（hash 相同、文件名不同）的文件同时导入，
 *   原实现会都通过查重 → 重复入库。现在同步标记保证只写一次。
 * 用 vi.mock 隔离 IndexedDB 与文件解析，专注去重逻辑。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { BookRecord } from '../core/Book'

vi.mock('../core/hash', () => ({ partialMD5: vi.fn() }))
vi.mock('../core/Storage', () => ({ getBookByHash: vi.fn(), addBook: vi.fn() }))
vi.mock('../providers/epubMeta', () => ({
  extractBookMeta: vi.fn(),
  generateId: vi.fn(() => 'generated-id'),
  detectFormat: vi.fn(),
}))

import { partialMD5 } from '../core/hash'
import { getBookByHash, addBook } from '../core/Storage'
import { extractBookMeta } from '../providers/epubMeta'
import { importFiles } from './importService'

const f1 = new File(['content'], 'a.epub')
const f2 = new File(['content'], 'b.epub') // 内容相同、文件名不同
const META = { title: '书', author: '', cover: null, format: 'epub' as const }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBookByHash).mockResolvedValue(null)
  vi.mocked(extractBookMeta).mockResolvedValue(META)
  vi.mocked(addBook).mockResolvedValue(undefined)
})

describe('importFiles 批内去重', () => {
  it('同批相同 hash 只导入一本，另一本计 skipped', async () => {
    vi.mocked(partialMD5).mockResolvedValue('same-hash')
    const result = await importFiles([f1, f2])
    expect(result).toEqual({ imported: 1, skipped: 1, failed: 0 })
    expect(addBook).toHaveBeenCalledTimes(1)
    const written = vi.mocked(addBook).mock.calls[0][0] as BookRecord
    expect(written.hash).toBe('same-hash')
  })

  it('不同 hash 并发导入都成功', async () => {
    vi.mocked(partialMD5).mockImplementation(async f =>
      (f as File).name === 'a.epub' ? 'hash-a' : 'hash-b',
    )
    const result = await importFiles([f1, f2])
    expect(result).toEqual({ imported: 2, skipped: 0, failed: 0 })
    expect(addBook).toHaveBeenCalledTimes(2)
  })

  it('库里已存在的 hash 计 skipped 且不重复写库', async () => {
    vi.mocked(partialMD5).mockResolvedValue('existing-hash')
    vi.mocked(getBookByHash).mockResolvedValue({ id: 'old' } as BookRecord)
    const result = await importFiles([f1])
    expect(result).toEqual({ imported: 0, skipped: 1, failed: 0 })
    expect(addBook).not.toHaveBeenCalled()
  })

  it('指纹计算失败计 failed，不影响其他文件', async () => {
    vi.mocked(partialMD5)
      .mockRejectedValueOnce(new Error('read error'))
      .mockResolvedValueOnce('hash-b')
    const result = await importFiles([f1, f2])
    expect(result.failed).toBe(1)
    expect(result.imported).toBe(1)
  })
})

describe('importFiles 跨批并发去重', () => {
  it('两批同时导入相同 hash 只写一次库', async () => {
    vi.mocked(partialMD5).mockResolvedValue('same-hash')
    // 两批并发：第 2 批进入同步去重阶段时，第 1 批已标记 hash
    const [a, b] = await Promise.all([importFiles([f1]), importFiles([f2])])
    expect(a.imported + b.imported).toBe(1)
    expect(a.skipped + b.skipped).toBe(1)
    expect(addBook).toHaveBeenCalledTimes(1)
  })
})

describe('失败释放锁', () => {
  it('写库失败后释放 hash，下次可重新导入', async () => {
    vi.mocked(partialMD5).mockResolvedValue('hash-x')
    vi.mocked(addBook).mockRejectedValueOnce(new Error('db full')).mockResolvedValue(undefined)

    const first = await importFiles([f1])
    expect(first.failed).toBe(1)

    const second = await importFiles([f1])
    expect(second.imported).toBe(1)
    expect(addBook).toHaveBeenCalledTimes(2)
  })

  it('指纹失败未标记 hash，不会污染后续导入', async () => {
    vi.mocked(partialMD5).mockRejectedValueOnce(new Error('read error')).mockResolvedValue('hash-y')
    await importFiles([f1])
    const second = await importFiles([f2])
    expect(second.imported).toBe(1)
  })
})
