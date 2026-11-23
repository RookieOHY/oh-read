/**
 * 内容哈希 —— 书籍去重的唯一依据
 *
 * 采用 KOReader 的 partialMD5 算法（Readest / kosync 进度同步生态同款）：
 * 不读整个文件，只在固定的稀疏偏移位置采样 1KB 片段计算 MD5，
 * 任何大小的文件最多只读约 12KB —— 内存与 IO 开销极小，符合内存优先约束。
 *
 * 参考实现：Readest apps/readest-app/src/utils/md5.ts
 * 原始算法：KOReader frontend/util.lua util.partialMD5
 */

import { md5 } from 'js-md5'

/** 采样区间表：给定文件大小，返回参与哈希的 [start, end) 字节区间 */
export function partialMD5Ranges(fileSize: number): Array<[number, number]> {
  const step = 1024
  const size = 1024
  const ranges: Array<[number, number]> = []
  // 偏移按 4 的幂递增：0, 1K, 4K, 16K, 64K, ... 1G
  // （1024 << -2 在 JS 里溢出为 0，等价于从文件开头采样）
  for (let i = -1; i <= 10; i++) {
    const start = Math.min(fileSize, step << (2 * i))
    const end = Math.min(start + size, fileSize)
    if (start >= fileSize) break
    ranges.push([start, end])
  }
  return ranges
}

/** 计算一本书的内容指纹（partial MD5），重复导入据此判定"同一本书" */
export async function partialMD5(file: Blob): Promise<string> {
  const ranges = partialMD5Ranges(file.size)
  // 并发读取所有采样片段（每片 1KB，Blob.slice 不复制数据）
  const chunks = await Promise.all(ranges.map(([start, end]) => file.slice(start, end).arrayBuffer()))
  const hasher = md5.create()
  for (const buf of chunks) hasher.update(new Uint8Array(buf))
  return hasher.hex()
}
