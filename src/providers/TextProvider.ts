/**
 * TXT / 网络小说支持（TextProvider）
 *
 * foliate-js 不自带 TXT 解析器，这里按官方 book 接口自行实现，
 * 产出的对象直接交给 view.open() 走与 EPUB 相同的渲染管线。
 *
 * 实现要点（借鉴 Legado / ohrengine 的经验）：
 * - 编码探测：UTF-8（严格模式）→ GB18030（覆盖 GBK）→ Big5，中文场景足够
 * - 章节切分用"规则组竞争"：一组标题正则切出的单章超过 5 万字，
 *   说明这组规则不适用（切漏了），换下一组；全部失败则按字数分块
 * - 每章生成一段简单 HTML（标题 + 段落），以 blob URL 提供给渲染器，
 *   dispose 时统一 revoke，避免内存驻留
 * - 切分结果按内容指纹缓存到 IndexedDB（core/Storage 的 txtCache 表），
 *   避免每次打开全量重新切分（8MB 全本切分约百毫秒级）
 *
 * 后续优化（TODO）：首次切分仍在主线程，超大文件可移入 Web Worker。
 */

import type { FoliateBook } from '../types/foliate'
import type { TxtChapter } from '../core/Book'
import { loadTxtCache, saveTxtCache } from '../core/Storage'

// ---------------------------------------------------------------------------
// 编码探测
// ---------------------------------------------------------------------------

/**
 * 探测文本编码：UTF-8 → GB18030 → Big5。
 * UTF-8 用严格模式（fatal）——GBK 文件在 UTF-8 严格解码下几乎必然抛错；
 * 判断头部时回退最多 3 字节，避免 slice 边缘截断多字节字符造成误判。
 */
export async function detectTxtEncoding(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer())
  const candidates: string[] = ['utf-8', 'gb18030', 'big5']
  for (const encoding of candidates) {
    for (let back = 0; back <= 3; back++) {
      const end = Math.max(0, head.length - back)
      try {
        // fatal: true —— 遇到非法/截断字节直接抛错而不是替换为 U+FFFD
        new TextDecoder(encoding, { fatal: true }).decode(head.subarray(0, end))
        return encoding
      } catch {
        // 该回退字节数下失败，尝试多回退一个字节
      }
    }
  }
  return 'utf-8'
}

// ---------------------------------------------------------------------------
// 章节切分
// ---------------------------------------------------------------------------

/**
 * 标题行规则组（按可信度排序）。
 * 只匹配"整行就是标题"的行（锚定行首 + 限制行长度），
 * 避免"第X章"出现在段落中间被误判。
 */
const TITLE_RULES: Array<{ name: string; test: (line: string) => boolean }> = [
  {
    // 中文章回：第一章 / 第 1234 回 / 第两百零三节（行首 + 行长约束）
    name: '中文章回',
    test: line => {
      const t = line.trim()
      return t.length <= 60 && /^第[ \t]*[0-9〇零一二三四五六七八九十百千万两]+[ \t]*[章回节卷集部篇]/.test(t)
    },
  },
  {
    // 英文：Chapter 1 / CHAPTER XII
    name: 'Chapter N',
    test: line => {
      const t = line.trim()
      return t.length <= 60 && /^(Chapter|CHAPTER)\s+[\dIVXLCivxlc]+/.test(t)
    },
  },
  {
    // 常见网络小说特殊标题：楔子 / 序章 / 番外 / 尾声 / 终章 等
    name: '特殊标题',
    test: line => {
      const t = line.trim()
      return t.length > 0 && t.length <= 20 && /^(楔子|序章|序言|前言|后记|尾声|终章|番外[ \t]*[一二三四五六七八九十]*)$/.test(t)
    },
  },
]

/**
 * 竞争判定阈值：单章正文超过这个字数，说明该规则组切漏了
 * （正文被并进了某个"标题"里），换下一组规则。
 */
const RULE_MAX_CHAPTER_CHARS = 50000

/**
 * 用一组规则尝试切分。
 * 返回 null 表示这组规则不适用（Legado 的"规则组竞争"判定）：
 * - 完全没有标题行
 * - 某一章超过竞争阈值（说明规则切漏了）
 */
function splitByRule(lines: string[], rule: (line: string) => boolean): TxtChapter[] | null {
  // 记录标题行的行号
  const starts: number[] = []
  lines.forEach((line, i) => {
    if (rule(line)) starts.push(i)
  })
  // 完全没有标题行 → 该规则不适用
  if (starts.length === 0) return null

  // 第一章从文件开头算起（标题之前的前言归入第一章）
  const chapters: TxtChapter[] = []
  for (let s = 0; s < starts.length; s++) {
    const to = s + 1 < starts.length ? starts[s + 1] : lines.length
    let text: string
    if (s === 0) {
      // 第一章 = 前言（0 ~ 第一个标题行之前）+ 标题行之后的正文
      // （去掉标题行本身，标题存在 title 字段里）
      text = [...lines.slice(0, starts[0]), ...lines.slice(starts[0] + 1, to)].join('\n').trim()
    } else {
      // 其余章节：标题行的下一行到下一章标题之前
      text = lines.slice(starts[s] + 1, to).join('\n').trim()
    }
    chapters.push({ title: lines[starts[s]].trim(), text })
  }
  // 竞争判定：任何一章超过阈值即判定该规则切漏
  if (chapters.some(c => c.text.length > RULE_MAX_CHAPTER_CHARS)) return null
  return chapters
}

/**
 * 兜底：无章节标记的文本按约 6000 字符一块分块。
 * 标题取每块第一行的前 20 个字符。
 */
function splitBySize(text: string): TxtChapter[] {
  const paragraphs = text.split(/\n+/)
  const chapters: TxtChapter[] = []
  let buf: string[] = []
  let size = 0
  const push = () => {
    if (buf.length === 0) return
    const head = buf[0].trim()
    chapters.push({
      title: head.slice(0, 20) || `第 ${chapters.length + 1} 部分`,
      text: buf.join('\n'),
    })
    buf = []
    size = 0
  }
  for (const p of paragraphs) {
    // 单段超过块阈值时硬切（段落自身没有换行可以依赖，必须按字符切）——
    // 否则一个几万字的巨型段落会产生一个巨型"章"，页渲染和进度都会失衡
    let rest = p
    while (size + rest.length >= 6000) {
      const take = 6000 - size
      if (take > 0) {
        buf.push(rest.slice(0, take))
        push()
      }
      rest = rest.slice(take)
    }
    if (rest.length > 0) {
      buf.push(rest)
      size += rest.length
    }
    if (size >= 6000) push()
  }
  push()
  // 全空文本兜底：分块结果为空内容时给占位章
  if (chapters.length === 0 || chapters.every(c => c.text.trim() === '')) {
    chapters.length = 0
    chapters.push({ title: '正文', text: text.trim() || '（空文件）' })
  }
  return chapters
}

/** 切分整本 TXT：依次尝试规则组，全部失败则按字数分块 */
export function splitTxtChapters(text: string): TxtChapter[] {
  const lines = text.split(/\r\n|\r|\n/)
  for (const rule of TITLE_RULES) {
    const chapters = splitByRule(lines, rule.test)
    if (chapters) return chapters
  }
  return splitBySize(text)
}

// ---------------------------------------------------------------------------
// foliate book 接口适配
// ---------------------------------------------------------------------------

/** XML/HTML 文本转义（章节标题进入 HTML） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 把一章转成独立 HTML 文档（标题锚点 + 段落），供渲染器以 blob URL 加载 */
function chapterToHtml(chapter: TxtChapter, index: number): string {
  const paragraphs = chapter.text
    .split(/\n+/)
    .filter(p => p.trim().length > 0)
    .map(p => `<p>${escapeHtml(p.trim())}</p>`)
    .join('\n')
  // 颜色用系统标准值（Canvas/CanvasText），自动跟随明暗模式
  // 注意：内容必须铺满整个分页列宽（不要用 max-width/auto 居中），
  // 边距由 foliate paginator 的 margin 属性统一控制；
  // 自行限制宽度会与分页定位错位，导致页面显示空白。
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(chapter.title)}</title>
<style>
  html { color-scheme: light dark; }
  body { margin: 0; padding: 0 1.5em; line-height: 1.8; color: CanvasText; background: Canvas; }
  h1 { font-size: 1.3em; margin: 1em 0 1.2em; }
  p { margin: 0 0 .9em; text-indent: 2em; }
</style></head>
<body><h1 id="oread-ch-${index}">${escapeHtml(chapter.title)}</h1>
${paragraphs}</body></html>`
}

/**
 * 构建 foliate book 接口对象（TXT 专用）。
 * 用法：view.open(await buildTxtBook(file, 书名))
 *
 * 切分结果会缓存到 IndexedDB（key = 内容指纹 hash），
 * 第二次打开同一本书时直接读缓存，跳过全量解码与切分。
 */
export async function buildTxtBook(file: Blob, hash: string, fallbackTitle: string): Promise<FoliateBook> {
  // 先查缓存：命中则跳过全量解码与切分（大文件的性能关键路径）
  let chapters = await loadTxtCache(hash)
  if (!chapters) {
    const encoding = await detectTxtEncoding(file)
    const text = new TextDecoder(encoding).decode(await file.arrayBuffer())
    chapters = splitTxtChapters(text)
    // 缓存失败不影响阅读（存储满等异常静默）
    void saveTxtCache(hash, chapters).catch(err => console.warn('TXT 切分缓存失败：', err))
  }

  // blob URL 缓存：同一章多次进入只创建一次；dispose 时统一释放
  const urls = new Map<number, string>()
  const releaseUrl = (index: number) => {
    const url = urls.get(index)
    if (url) {
      URL.revokeObjectURL(url)
      urls.delete(index)
    }
  }

  return {
    metadata: {
      title: fallbackTitle,
      author: '',
      language: 'zh',
    },
    dir: 'ltr',
    // 章节列表：每章一个 section，size 用字符数（进度引擎据此估算全书比例）
    sections: chapters.map((chapter, index) => ({
      id: String(index),
      size: Math.max(1, chapter.text.length + chapter.title.length),
      linear: 'yes',
      // load() 返回章节文档的 blob URL
      load: () => {
        let url = urls.get(index)
        if (!url) {
          url = URL.createObjectURL(new Blob([chapterToHtml(chapter, index)], { type: 'text/html' }))
          urls.set(index, url)
        }
        return url
      },
      // unload()：渲染器离开该章时释放该章的 blob URL
      unload: () => releaseUrl(index),
    })),
    // 目录：纯章节列表
    toc: chapters.map((chapter, index) => ({
      label: chapter.title,
      href: `#${index}`,
      subitems: [],
    })),
    pageList: [],
    // 目录点击跳转：href 形如 "#3"，解析为第 3 章（foliate 的 view.goTo 内部走这里）
    resolveHref(href: string) {
      const index = Number(href.slice(1))
      if (!Number.isInteger(index) || index < 0 || index >= chapters.length) return null
      return { index, anchor: (doc: Document) => doc.getElementById(`oread-ch-${index}`) }
    },
    // progress.js 所需的两个定位方法（不实现则全书进度引擎不会初始化）
    splitTOCHref(href: string) {
      return [href.slice(1), null]
    },
    getTOCFragment(doc: Document, id: string) {
      // 锚到该章标题元素；找不到时退回文档根
      return doc.getElementById(`oread-ch-${id}`) ?? doc.documentElement
    },
    // 渲染结束时释放全部 blob URL（ReaderView 的 cleanup 调用）
    dispose: () => {
      urls.forEach(url => URL.revokeObjectURL(url))
      urls.clear()
    },
  }
}
