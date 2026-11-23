/**
 * 导入服务 —— 把"文件 → 书架记录"的完整管线收口到这里
 *
 * 管线：内容指纹（去重）→ 元数据提取 → 写库
 *
 * 并发策略（三阶段，关键在"同步标记"）：
 *   1. 并发计算内容指纹（只读采样片段，无副作用）
 *   2. 同步去重：批内相同 hash 只留一本；跨批用 in-flight Set 锁住
 *   3. 并发查库 + 写库（不同 hash 之间互不干扰，保留导入速度）
 *
 * 为什么需要 in-flight Set：
 *   原实现把"查重 → 写库"放在同一个 async 回调里，Promise.all 并发下，
 *   两本内容相同（hash 相同、文件名不同）的文件会同时通过 getBookByHash
 *   （都还没写库），然后都 addBook → 重复入库。
 *   现在在第 2 阶段同步标记 hash，杜绝这个竞态窗口；第 3 阶段 finally
 *   释放标记，失败的书下次还能重新导入。
 */

import type { BookRecord } from '../core/Book'
import { partialMD5 } from '../core/hash'
import { addBook, getBookByHash } from '../core/Storage'
import { extractBookMeta, generateId } from '../providers/epubMeta'

/** 一次批量导入的汇总结果 */
export interface ImportResult {
  /** 成功入库的数量 */
  imported: number
  /** 因内容指纹重复而跳过的数量 */
  skipped: number
  /** 失败的数量（详情已在 console 打印） */
  failed: number
}

/**
 * 正在导入中的 hash（同步锁）。
 * 必须在 await 之前同步读写，才能挡住并发批次同时通过查重。
 */
const importingHashes = new Set<string>()

/** 批量导入文件 */
export async function importFiles(fileList: FileList | File[]): Promise<ImportResult> {
  const files = Array.from(fileList)
  let failed = 0
  let skipped = 0

  // 阶段 1：并发算指纹（纯读，无副作用）
  const hashed = await Promise.all(
    files.map(async file => {
      try {
        return { file, hash: await partialMD5(file) }
      } catch (err) {
        console.error('内容指纹计算失败：', file.name, err)
        return null
      }
    }),
  )

  // 阶段 2：同步去重 + 标记（无 await，整段原子）
  const seen = new Set<string>()
  const tasks: Array<{ file: File; hash: string }> = []
  for (const item of hashed) {
    if (!item) {
      failed++
      continue
    }
    if (seen.has(item.hash) || importingHashes.has(item.hash)) {
      skipped++
      continue
    }
    seen.add(item.hash)
    importingHashes.add(item.hash)
    tasks.push(item)
  }

  // 阶段 3：并发查库 + 写库（不同 hash 独立事务）
  const results = await Promise.all(
    tasks.map(async ({ file, hash }) => {
      try {
        const existing = await getBookByHash(hash)
        if (existing) return 'skipped' as const

        const meta = await extractBookMeta(file)
        const record: BookRecord = {
          id: generateId(),
          hash,
          title: meta.title,
          author: meta.author,
          format: meta.format,
          cover: meta.cover,
          // File 是 Blob 的子类，可直接入库存
          file,
          fileName: file.name,
          addedAt: Date.now(),
        }
        await addBook(record)
        return 'imported' as const
      } catch (err) {
        console.error('导入失败：', file.name, err)
        return 'failed' as const
      } finally {
        // 成功/失败/库里已有都要释放锁，否则该 hash 永远无法再次导入
        importingHashes.delete(hash)
      }
    }),
  )

  let imported = 0
  for (const r of results) {
    if (r === 'imported') imported++
    else if (r === 'skipped') skipped++
    else failed++
  }
  return { imported, skipped, failed }
}

/** 按导入结果生成一句话汇总（显示在 toast 上） */
export function summarizeImport(result: ImportResult): string {
  const parts: string[] = []
  if (result.imported > 0) parts.push(`已导入 ${result.imported} 本`)
  if (result.skipped > 0) parts.push(`${result.skipped} 本已在书架`)
  if (result.failed > 0) parts.push(`${result.failed} 本失败`)
  return parts.join(' · ') || '没有可导入的文件'
}
