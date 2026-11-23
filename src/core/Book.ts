/**
 * 书籍数据模型定义
 *
 * 这里定义的是「存储层的最小单元」：一本书在本地数据库里的完整记录。
 * 后续阅读器、进度、书单等功能都基于这份记录工作。
 */

/** 书籍格式 */
export type BookFormat = 'epub' | 'txt' | 'pdf' | 'other'

/** 一本书在本地数据库中的记录 */
export interface BookRecord {
  /** 唯一标识（导入时用 UUID 生成） */
  id: string
  /** 书名（来自 EPUB 元数据，或文件名兜底） */
  title: string
  /** 作者（EPUB 元数据；TXT 等格式为空字符串） */
  author: string
  /** 书籍格式 */
  format: BookFormat
  /** 封面图片（null 表示无封面，UI 会用书名首字生成占位封面） */
  cover: Blob | null
  /**
   * 书籍文件本体（EPUB ZIP / TXT 纯文本 / PDF）。
   * File 是 Blob 的子类，可以直接以 Blob 形式存入 IndexedDB，
   * 浏览器会把它落盘，不会常驻内存 —— 符合"内存优先"约束。
   */
  file: Blob
  /** 原始文件名（显示和调试用） */
  fileName: string
  /** 导入时间戳（毫秒），书架按它倒序排列 */
  addedAt: number
}
