/**
 * 书籍元数据提取器
 *
 * 职责：拿到一个导入的 File，提取书名 / 作者 / 封面 / 格式。
 *
 * - EPUB：用 zip.js **按需**解压 container.xml、OPF 清单和封面图，
 *   zip.js 对 File 对象支持随机访问，只读取需要的字节段，
 *   不会把整本书读进内存（内存优先约束）。
 * - TXT / PDF：书名直接用文件名，封面为空（后续由各自 Provider 处理正文）。
 *
 * 所有解析失败都会降级为「文件名作为书名」，绝不让导入流程中断。
 */

/**
 * 注意：zip.js 用动态 import 按需加载 —— 主包体积不包含它，
 * 只在真正导入 EPUB 时才下载解析（启动速度优先约束）。
 */

import type * as zipTypes from '@zip.js/zip.js'
import type { BookFormat } from '../core/Book'

/** 惰性加载 zip.js 模块 */
async function loadZip() {
  return await import('@zip.js/zip.js')
}

/** 提取出的元数据 */
export interface BookMeta {
  title: string
  author: string
  cover: Blob | null
  format: BookFormat
}

/** 判断条目是否为文件（目录条目没有 getData 方法） */
function isFileEntry(entry: zipTypes.Entry | undefined): entry is zipTypes.FileEntry {
  return entry !== undefined && entry.directory !== true
}

/** 生成随机 id（导入时用） */
export function generateId(): string {
  return crypto.randomUUID()
}

/** 根据文件名推断格式 */
export function detectFormat(fileName: string): BookFormat {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  if (ext === 'epub') return 'epub'
  if (ext === 'txt') return 'txt'
  if (ext === 'pdf') return 'pdf'
  return 'other'
}

/** 提取元数据的统一入口 */
export async function extractBookMeta(file: File): Promise<BookMeta> {
  // 兜底书名：去掉扩展名
  const title = file.name.replace(/\.[^.]+$/, '')
  const format = detectFormat(file.name)

  // EPUB 走真正的解析，失败就降级
  if (format === 'epub') {
    try {
      return await extractEpubMeta(file, title)
    } catch (err) {
      console.warn('EPUB 元数据解析失败，使用文件名作为书名：', err)
    }
  }

  return { title, author: '', cover: null, format }
}

/**
 * 解析 EPUB 元数据
 *
 * EPUB 是一个 ZIP 包，标准结构：
 *   META-INF/container.xml  → 指向 OPF 清单的位置
 *   <opfPath>               → 书名/作者/封面清单（manifest + metadata）
 */
async function extractEpubMeta(file: File, fallbackTitle: string): Promise<BookMeta> {
  // 按需加载 zip.js（首次导入 EPUB 时才加载这一块代码）
  const zip = await loadZip()
  // ZipReader 读取文件目录，此时并未解压任何内容
  const zipFile = new zip.ZipReader(new zip.BlobReader(file))
  try {
    const entries = await zipFile.getEntries()
    // 按精确路径查找「文件」条目的小工具（自动排除目录条目）
    const byName = (name: string): zipTypes.FileEntry | undefined => {
      const found = entries.find(e => e.filename === name)
      return isFileEntry(found) ? found : undefined
    }

    // ---- 第 1 步：container.xml → OPF 路径 ----
    const containerEntry = byName('META-INF/container.xml')
    if (!containerEntry) throw new Error('缺少 META-INF/container.xml')
    const containerXml = await containerEntry.getData(new zip.TextWriter())
    const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml')
    const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path')
    if (!opfPath) throw new Error('container.xml 中没有 rootfile')

    // ---- 第 2 步：解析 OPF（书名 / 作者 / 封面引用）----
    const opfEntry = byName(opfPath)
    if (!opfEntry) throw new Error(`OPF 文件不存在：${opfPath}`)
    const opfXml = await opfEntry.getData(new zip.TextWriter())
    const opf = new DOMParser().parseFromString(opfXml, 'application/xml')

    // Dublin Core 命名空间下的标题与作者
    const DC = 'http://purl.org/dc/elements/1.1/'
    const title = opf.getElementsByTagNameNS(DC, 'title')[0]?.textContent?.trim() || fallbackTitle
    const author = opf.getElementsByTagNameNS(DC, 'creator')[0]?.textContent?.trim() || ''

    // 封面有两种声明方式：
    //   EPUB 3：manifest 里 properties 包含 "cover-image" 的 item
    //   EPUB 2：metadata 里 <meta name="cover" content="item-id"/>
    const manifestItems = Array.from(opf.getElementsByTagName('item'))
    const coverByProperty = manifestItems.find(item =>
      item.getAttribute('properties')?.split(/\s+/).includes('cover-image'),
    )
    let coverHref: string | undefined = coverByProperty?.getAttribute('href') ?? undefined
    if (!coverHref) {
      // EPUB 2 的兼容路径：meta[name=cover] → 对应 id 的 item
      const coverId = Array.from(opf.getElementsByTagName('meta')).find(
        m => m.getAttribute('name') === 'cover',
      )?.getAttribute('content')
      if (coverId) {
        coverHref = manifestItems
          .find(item => item.getAttribute('id') === coverId)
          ?.getAttribute('href') ?? undefined
      }
    }

    // ---- 第 3 步：按需解压封面图片 ----
    let cover: Blob | null = null
    if (coverHref) {
      // href 是相对 OPF 所在目录的路径，需要拼出包内完整路径
      const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
      const fullPath = opfDir + coverHref
      // 有的书籍对路径做了 URL 编码，两种写法都试一次
      // 有的书籍对路径做了 URL 编码，先按精确路径找，找不到再试编解码变体
      let coverEntry: zipTypes.FileEntry | undefined = byName(fullPath)
      if (!coverEntry) {
        const alt = entries.find(
          e =>
            e.directory !== true &&
            (e.filename === decodeURIComponent(fullPath) || e.filename === encodeURI(fullPath)),
        )
        coverEntry = isFileEntry(alt) ? alt : undefined
      }
      if (coverEntry) {
        cover = (await coverEntry.getData(new zip.BlobWriter())) ?? null
      }
    }

    return { title, author, cover, format: 'epub' }
  } finally {
    // 释放 zip 底层文件访问句柄（内存与句柄都要及时归还）
    await zipFile.close()
  }
}
