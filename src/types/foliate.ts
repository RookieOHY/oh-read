/**
 * foliate-js book 接口的最小类型声明
 *
 * foliate-js 是无类型的纯 JS 库；这里按我们实际用到的 API 定义接口，
 * 让各格式 Provider（TextProvider 等）与 ReaderView 之间的契约显式化。
 * 结构参考 @somecat/epub-reader 对同一库的类型组织。
 */

/** 单个章节 section（book.sections 的元素） */
export interface FoliateSection {
  /** 章节标识（TOC 定位用，任意字符串） */
  id: string
  /** 内容大小（进度引擎据此估算全书比例；字符数或字节数均可） */
  size?: number
  /** 是否属于线性阅读序列（EPUB 的 linear 属性；TXT 固定 'yes'） */
  linear?: string
  /** 加载该章内容，返回可渲染的 URL（通常是 blob: URL） */
  load: () => string
  /** 渲染器离开该章时调用（释放 blob URL 等） */
  unload?: () => void
}

/** 目录条目 */
export interface FoliateTocItem {
  label: string
  href: string
  subitems: FoliateTocItem[]
}

/** book 对象：格式解析器的产出，交给 view.open(book) 渲染 */
export interface FoliateBook {
  metadata: {
    title: string
    author?: string
    language?: string
  }
  /** 阅读方向：ltr / rtl */
  dir: string
  sections: FoliateSection[]
  toc: FoliateTocItem[]
  pageList?: FoliateTocItem[]
  /**
   * progress.js 所需：把 TOC 的 href 拆成 [sectionId, fragment]
   * （实现它，全书进度引擎 SectionProgress 才会初始化）
   */
  splitTOCHref?: (href: string) => [string, unknown]
  /** 把 sectionId + fragment 解析为文档内锚点节点 */
  getTOCFragment?: (doc: Document, id: string) => Node | null
  /**
   * 把 TOC 的 href 解析为跳转目标 { index, anchor? }。
   * view.goTo(href) 最终走这里——不实现则目录点击无效（EPUB 自带，TXT 需自行实现）。
   */
  resolveHref?: (href: string) => { index: number; anchor?: (doc: Document) => Node | null } | null
  /**
   * 一次性释放资源（非 foliate 接口，是我们自己的扩展）：
   * 渲染结束时由 ReaderView 调用，revoke 所有 blob URL。
   */
  dispose?: () => void
}
