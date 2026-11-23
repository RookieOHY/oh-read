/**
 * 阅读器启动策略 —— 「单窗口阅读」与「多窗口阅读」的切换点（文档占位）
 *
 * 当前实现（方案 A）：App 的 handleOpen 直接 setReadingBook(book)，
 * 在当前窗口内切换到阅读视图（ReaderView 组件）。本文件暂无运行时代码。
 *
 * 未来（方案 B，参考 Readest 的做法）：点击书架上的书时生成一个独立的
 * Tauri 原生窗口（WebviewWindow），把 ReaderView 作为该窗口的页面复用
 * —— ReaderView 本身与窗口无关，方案 B 只需把 handleOpen 换成这里的
 * 实现，上层 UI 零改动。
 *
 * 方案 B 的实现骨架（届时启用）：
 *   1. 依赖已就位（@tauri-apps/api 已安装），无需新增
 *   2. import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
 *   3. 书籍内容通过 bookId 在新窗口内从 IndexedDB 自取（跨窗口不传 Blob）
 *   4. 阅读器窗口的进度更新写入共享存储，书架窗口监听 storage 事件刷新
 */
