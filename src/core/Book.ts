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
  /**
   * 内容指纹（partial MD5，见 core/hash.ts）。
   * 去重依据：同一文件的指纹相同，无论文件名/位置怎么变都判定为同一本书。
   * 阅读进度也按 hash 关联（删除重导/跨设备进度不丢）。
   */
  hash: string
  /** 书名（来自 EPUB 元数据，或文件名兜底） */
  title: string
  /** 作者（EPUB 元数据；TXT 等格式为空字符串） */
  author: string
  /** 书籍格式 */
  format: BookFormat
  /** 封面图片（null 表示无封面，UI 会用书名首字生成占位封面） */
  cover: Blob | null
  /**
   * 书籍文件本体（EPUB ZIP / TXT 纯文本 / CBZ）。
   * File 是 Blob 的子类，可以直接以 Blob 形式存入 IndexedDB，
   * 浏览器会把它落盘，不会常驻内存 —— 符合"内存优先"约束。
   */
  file: Blob
  /** 原始文件名（显示和调试用） */
  fileName: string
  /** 导入时间戳（毫秒），书架按它倒序排列 */
  addedAt: number
}

/**
 * 书架列表用的轻量投影：**不含文件本体**。
 *
 * 书架刷新频繁，若每次全量拉取记录（含 file Blob），书库越大开销越大；
 * 列表只取展示所需字段，阅读时再按 id 单独取完整记录（见 core/Storage 的 getBook）。
 */
export type BookMetaLite = Pick<
  BookRecord,
  'id' | 'hash' | 'title' | 'author' | 'format' | 'cover' | 'fileName' | 'addedAt'
>

/**
 * TXT 的一个章节：标题 + 正文文本。
 * 由 TextProvider 的切分器产出，也会按 hash 缓存到 IndexedDB。
 */
export interface TxtChapter {
  title: string
  text: string
}
