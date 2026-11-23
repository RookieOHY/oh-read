/**
 * 阅读进度存取测试
 *
 * 用内存版 localStorage stub（vi.stubGlobal）代替依赖测试环境的全局实现：
 * Node 22+ 自带一个全局 localStorage（sqlite backed），但方法集不全（如无 clear），
 * 与 jsdom/浏览器的差异会让测试变得环境敏感——stub 掉就完全可控。
 *
 * 重点验证：按 hash 关联的读写一致性与隔离性。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadProgress, saveProgress, clearProgress, loadAllProgress } from './progress'

/** 与 Web Storage API 对齐的内存实现（测试专用） */
class MemoryStorage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  clear(): void {
    this.map.clear()
  }
}

const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('progress（按内容指纹 hash 关联）', () => {
  it('保存后能读回（round-trip）', () => {
    saveProgress(HASH_A, { index: 3, fraction: 0.5, overall: 0.42, updatedAt: 1234 })
    const p = loadProgress(HASH_A)
    expect(p).toEqual({ index: 3, fraction: 0.5, overall: 0.42, updatedAt: 1234 })
  })

  it('未保存的书返回 null（从头开始读）', () => {
    expect(loadProgress(HASH_B)).toBeNull()
  })

  it('不同书（不同 hash）的进度互不干扰', () => {
    saveProgress(HASH_A, { index: 1, fraction: 0.1, overall: 0.1, updatedAt: 1 })
    saveProgress(HASH_B, { index: 2, fraction: 0.2, overall: 0.2, updatedAt: 2 })
    expect(loadProgress(HASH_A)?.overall).toBe(0.1)
    expect(loadProgress(HASH_B)?.overall).toBe(0.2)
  })

  it('覆盖写：同一本书读到最后写的值', () => {
    saveProgress(HASH_A, { index: 1, fraction: 0.1, overall: 0.1, updatedAt: 1 })
    saveProgress(HASH_A, { index: 5, fraction: 0.9, overall: 0.8, updatedAt: 2 })
    expect(loadProgress(HASH_A)?.overall).toBe(0.8)
  })

  it('clearProgress 删除记录', () => {
    saveProgress(HASH_A, { index: 1, fraction: 0.1, overall: 0.1, updatedAt: 1 })
    clearProgress(HASH_A)
    expect(loadProgress(HASH_A)).toBeNull()
  })

  it('loadAllProgress 返回全部并按时间倒序', () => {
    saveProgress(HASH_A, { index: 1, fraction: 0.1, overall: 0.1, updatedAt: 100 })
    saveProgress(HASH_B, { index: 2, fraction: 0.2, overall: 0.2, updatedAt: 200 })
    const all = loadAllProgress()
    expect(all).toHaveLength(2)
    expect(all[0].hash).toBe(HASH_B) // 更新的在前
    expect(all[1].hash).toBe(HASH_A)
  })
})
