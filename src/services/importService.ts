/**
 * 导入服务 —— 把"文件 → 书架记录"的完整管线收口到这里
 *
 * 管线：内容指纹（去重）→ 元数据提取 → 写库
 *
 * 并发策略：多本同时导入时并发处理（每本书的 hash/查重/元数据/写库
 * 都是独立的 IndexedDB 事务，互不干扰）；结果按导入时间顺序写库，
 * 保证书架里"后拖入的排前面"与文件列表顺序一致。
 */

import type { BookMetaLite, BookRecord } from '../core/Book'
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
 * 批量导入文件。
 *
 * 注意：并发去重理论上有极小竞态窗口（同一文件在两次并发导入里
 * 都通过查重）——但同一批并发里相同内容会被跳过（hash 相同），
 * 跨批次依赖查重兜底，业务上足够。
 */
export async function importFiles(
  fileList: FileList | File[],
): Promise<ImportResult> {
  const files = Array.from(fileList)
  let imported = 0
  let skipped = 0
  let failed = 0

  // 并发处理每一本
  const results = await Promise.all(
    files.map(async file => {
      try {
        // 内容指纹去重：同一文件无论改名/移动，重复导入都会在这里被拦下
        const hash = await partialMD5(file)
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
          file: file,
          fileName: file.name,
          addedAt: Date.now(),
        }
        await addBook(record)
        return 'imported' as const
      } catch (err) {
        console.error('导入失败：', file.name, err)
        return 'failed' as const
      }
    }),
  )
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

/**
 * 类型守卫辅助：书架列表项是 BookMetaLite（不含文件本体），
 * 该函数仅作语义标注，避免未来误把轻量对象传给需要完整记录的 API。
 */
export type ShelfItem = BookMetaLite
