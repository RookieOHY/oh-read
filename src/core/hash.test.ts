/**
 * 内容指纹（partial MD5）测试
 *
 * 重点验证 KOReader 算法的三个关键性质：
 * 1. 采样区间只依赖文件大小（小文件读头部，大文件稀疏采样）
 * 2. 同一内容无论包装成多少次 Blob，指纹稳定
 * 3. 内容不同 → 指纹不同（去重的基础）
 */

import { describe, it, expect } from 'vitest'
import { partialMD5, partialMD5Ranges } from './hash'

describe('partialMD5Ranges', () => {
  it('小文件：只从文件头部采样一个区间', () => {
    const ranges = partialMD5Ranges(512)
    expect(ranges).toEqual([[0, 512]])
  })

  it('恰好 1KB：区间截断到文件末尾', () => {
    const ranges = partialMD5Ranges(1024)
    expect(ranges).toEqual([[0, 1024]])
  })

  it('大文件：按 4 的幂稀疏采样（0, 1K, 4K, 16K...）', () => {
    const ranges = partialMD5Ranges(10 * 1024 * 1024) // 10MB
    const starts = ranges.map(([start]) => start)
    // 偏移序列应为 0, 1024, 4096, 16384, ...（JS 位移语义：1024 << -2 → 0）
    expect(starts[0]).toBe(0)
    expect(starts[1]).toBe(1024)
    expect(starts[2]).toBe(4096)
    expect(starts[3]).toBe(16384)
    // 每个区间最多 1024 字节
    for (const [start, end] of ranges) {
      expect(end - start).toBeLessThanOrEqual(1024)
      expect(end).toBeLessThanOrEqual(10 * 1024 * 1024)
    }
  })

  it('总采样量有上限（任何文件最多 ~12KB 读取量）', () => {
    const ranges = partialMD5Ranges(1024 * 1024 * 1024) // 1GB
    const total = ranges.reduce((sum, [s, e]) => sum + (e - s), 0)
    expect(total).toBeLessThanOrEqual(12 * 1024)
  })
})

describe('partialMD5', () => {
  it('同一内容指纹稳定（去重的正确性基础）', async () => {
    const data = '第一章 开端\n\n这是测试正文。'.repeat(100)
    const a = await partialMD5(new Blob([data]))
    const b = await partialMD5(new Blob([data]))
    expect(a).toBe(b)
    // 32 位十六进制 MD5
    expect(a).toMatch(/^[0-9a-f]{32}$/)
  })

  it('内容不同 → 指纹不同', async () => {
    const a = await partialMD5(new Blob(['content A'.repeat(50)]))
    const b = await partialMD5(new Blob(['content B'.repeat(50)]))
    expect(a).not.toBe(b)
  })

  it('大文件也能计算（稀疏采样不依赖全量读取）', async () => {
    // 2MB 数据，超过全部采样区间
    const big = new Uint8Array(2 * 1024 * 1024).fill(7)
    const hash = await partialMD5(new Blob([big]))
    expect(hash).toMatch(/^[0-9a-f]{32}$/)
  })
})
