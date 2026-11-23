/**
 * 阅读进度存取 —— 基于 localStorage
 *
 * 进度模型（与 foliate-js 的 relocate 事件对应）：
 *   index    当前章节序号
 *   fraction 章内阅读比例（0~1）
 *   overall  全书阅读比例（0~1，用于恢复定位，见 ReaderView 的换算）
 *   updatedAt 最后阅读时间（书架"正在阅读"排序用）
 *
 * 关联键是书的**内容指纹 hash** 而不是 UUID id：
 *   同一本书删除后重新导入、或跨设备同步时，内容不变 hash 不变，
 *   进度就能找回；UUID 是副本身份，会随删除重导而变化。
 *
 * 为什么用 localStorage 而不是 IndexedDB：
 *   进度数据极小（每本书一条 JSON），localStorage 读写同步、简单可靠；
 *   书籍文件才走 IndexedDB。后续接云同步时只需替换本模块实现。
 */

/** 单本书的阅读进度 */
export interface ReadingProgress {
  /** 当前章节序号（relocate 事件提供） */
  index: number
  /** 章内阅读比例 0~1（relocate 事件提供） */
  fraction: number
  /** 全书阅读比例 0~1（由章节权重换算，恢复定位用它） */
  overall: number
  /** 最后阅读时间戳 */
  updatedAt: number
}

const KEY_PREFIX = 'oread.progress.'

/** 读取某本书的进度（没有记录时返回 null，表示从头开始读） */
export function loadProgress(hash: string): ReadingProgress | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + hash)
    return raw ? (JSON.parse(raw) as ReadingProgress) : null
  } catch {
    return null
  }
}

/** 写入某本书的进度 */
export function saveProgress(hash: string, progress: ReadingProgress): void {
  try {
    localStorage.setItem(KEY_PREFIX + hash, JSON.stringify(progress))
  } catch (err) {
    // 存储满等异常不应打断阅读
    console.warn('进度保存失败：', err)
  }
}

/** 清除某本书的进度（删除书籍时顺带清理） */
export function clearProgress(hash: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + hash)
  } catch {
    // 忽略
  }
}

/** 读取全部进度（"正在阅读"页排序用；MVP 先占位） */
export function loadAllProgress(): Array<ReadingProgress & { hash: string }> {
  const list: Array<ReadingProgress & { hash: string }> = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(KEY_PREFIX)) {
      try {
        const p = JSON.parse(localStorage.getItem(key) ?? '') as ReadingProgress
        list.push({ ...p, hash: key.slice(KEY_PREFIX.length) })
      } catch {
        // 忽略坏数据
      }
    }
  }
  return list.sort((a, b) => b.updatedAt - a.updatedAt)
}
