/**
 * TXT 章节切分测试
 *
 * 覆盖"规则组竞争"的核心行为：
 * - 中文章回 / Chapter N / 特殊标题三组规则的识别
 * - 竞争判定：切漏（单章超阈值）时换下一组
 * - 无标记文本的按字数分块兜底
 * - 编码探测（UTF-8 / GB18030）
 */

import { describe, it, expect } from 'vitest'
import { splitTxtChapters, detectTxtEncoding } from './TextProvider'

describe('splitTxtChapters - 中文章回', () => {
  it('识别「第X章」标题并正确切分', () => {
    const text = [
      '第一章 初入江湖',
      '少年背上行囊。',
      '',
      '第二章 客栈风云',
      '茶馆里人声鼎沸。',
      '',
      '第三章 雨夜追杀',
      '夜半，暴雨如注。',
    ].join('\n')
    const chapters = splitTxtChapters(text)
    expect(chapters).toHaveLength(3)
    expect(chapters[0].title).toBe('第一章 初入江湖')
    expect(chapters[0].text).toContain('少年背上行囊')
    expect(chapters[1].title).toBe('第二章 客栈风云')
  })

  it('标题之前的前言归入第一章', () => {
    const text = [
      '《测试之书》',
      '作者：测试作者',
      '',
      '第一章 开始',
      '正文一。',
      '',
      '第二章 继续',
      '正文二。',
    ].join('\n')
    const chapters = splitTxtChapters(text)
    expect(chapters).toHaveLength(2)
    expect(chapters[0].text).toContain('《测试之书》')
  })

  it('段落中间的「第X章」不会被误判（不锚定行首的例外）', () => {
    const text = [
      '第一章 开始',
      '他说这是第三章节选的内容之一，但其实是正文。',
      '',
      '第二章 继续',
      '正文。',
    ].join('\n')
    const chapters = splitTxtChapters(text)
    // 行首约束：句中的"第三章节选"不在行首，不会成为标题
    expect(chapters.map(c => c.title)).toEqual(['第一章 开始', '第二章 继续'])
  })

  it('单章小说保留单章（不再按字数切碎）', () => {
    const text = '第一章 唯一\n\n' + '短篇正文。'.repeat(10)
    const chapters = splitTxtChapters(text)
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('第一章 唯一')
  })
})

describe('splitTxtChapters - Chapter N（英文）', () => {
  it('中文规则失败时换英文规则', () => {
    const text = [
      'Chapter 1 The Beginning',
      'English content here.',
      '',
      'Chapter 2 The Middle',
      'More content.',
    ].join('\n')
    const chapters = splitTxtChapters(text)
    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toBe('Chapter 1 The Beginning')
  })
})

describe('splitTxtChapters - 竞争判定', () => {
  it('单章超过 5 万字 → 换下一组规则或分块兜底', () => {
    // 只有一个"第一章"标题 + 超长正文 → 中文章回组竞争失败（单章超限）
    // 兜底按字数分块
    const longBody = '正文段落。'.repeat(12000) // 6 万字
    const text = '第一章 巨大\n\n' + longBody
    const chapters = splitTxtChapters(text)
    // 兜底分块：每块 ~6000 字符
    expect(chapters.length).toBeGreaterThan(5)
    expect(chapters[0].text.length).toBeLessThanOrEqual(6100)
  })
})

describe('splitTxtChapters - 兜底分块', () => {
  it('无章节标记的文本按 ~6000 字符分块', () => {
    // 40 段 × ~600 字 ≈ 24000 字 → 应分出 4+ 块
    const text = Array.from({ length: 40 }, (_, i) => `第${i}段内容，${'细节描写。'.repeat(100)}`).join('\n\n')
    const chapters = splitTxtChapters(text)
    expect(chapters.length).toBeGreaterThan(3)
    for (const c of chapters) {
      expect(c.text.length).toBeLessThanOrEqual(6100)
    }
  })

  it('空文件产生单一占位章', () => {
    const chapters = splitTxtChapters('')
    expect(chapters).toHaveLength(1)
    expect(chapters[0].text).toBe('（空文件）')
  })
})

describe('detectTxtEncoding', () => {
  it('UTF-8 中文文本识别为 utf-8', async () => {
    const blob = new Blob(['第一章 测试\n这是 UTF-8 编码的中文内容。'])
    expect(await detectTxtEncoding(blob)).toBe('utf-8')
  })

  it('GBK/GB18030 文本识别为 gb18030', async () => {
    // 用真实长度的 GBK 字节序列构造：「第一章」的 GBK 编码重复 200 次。
    // 注意序列必须足够长：太短的话，尾部回退 3 字节的容错机制
    // 会把整个序列绕成"合法 UTF-8"，造成误判。
    // GBK 编码：第=B5DA 一=D2BB 章=D5C2（每个都是合法的 GBK 双字节对）
    const unit = new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20])
    const gbkBytes = new Uint8Array(unit.length * 200)
    for (let i = 0; i < 200; i++) gbkBytes.set(unit, i * unit.length)
    const blob = new Blob([gbkBytes])
    expect(await detectTxtEncoding(blob)).toBe('gb18030')
  })
})
