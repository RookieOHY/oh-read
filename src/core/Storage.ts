/**
 * 本地存储层 —— 基于 IndexedDB
 *
 * 设计要点：
 * - 书籍文件以 Blob 存入 IndexedDB，由浏览器负责磁盘化存储与内存回收，
 *   应用进程里不会长期持有整本书的内容（内存优先约束）。
 * - 所有操作均为异步（Promise），UI 层不感知 IndexedDB 细节。
 * - 读写完成后立即 close()，避免连接长期占用。
 */

import type { BookRecord } from './Book'

/** 数据库名与版本（结构变更时递增 DB_VERSION 并在 onupgradeneeded 里做迁移） */
const DB_NAME = 'oread'
const DB_VERSION = 1
/** 书籍表名 */
const BOOK_STORE = 'books'

/** 打开数据库（首次运行时自动建表） */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    // 数据库首次创建 / 版本升级时触发，负责建表和索引
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(BOOK_STORE)) {
        const store = db.createObjectStore(BOOK_STORE, { keyPath: 'id' })
        // 给导入时间建索引，方便以后按时间范围查询
        store.createIndex('addedAt', 'addedAt')
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** 在事务里执行一次操作的小工具：完成后自动关库 */
function withTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
  postProcess?: (result: T) => T,
): Promise<T | void> {
  return openDB().then(
    db =>
      new Promise<T | void>((resolve, reject) => {
        const tx = db.transaction(BOOK_STORE, mode)
        const store = tx.objectStore(BOOK_STORE)
        const request = run(store)
        tx.oncomplete = () => {
          db.close()
          if (request && postProcess) resolve(postProcess(request.result))
          else resolve()
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
      }),
  )
}

/** 新增一本书 */
export async function addBook(record: BookRecord): Promise<void> {
  await withTransaction('readwrite', store => {
    store.add(record)
  })
}

/** 读取书架全部书籍（按导入时间倒序：最新导入的排最前） */
export async function getAllBooks(): Promise<BookRecord[]> {
  const list = await withTransaction<BookRecord[]>('readonly', store => store.getAll(), result =>
    (result ?? []).sort((a, b) => b.addedAt - a.addedAt),
  )
  return (list as BookRecord[]) ?? []
}

/** 删除一本书 */
export async function deleteBook(id: string): Promise<void> {
  await withTransaction('readwrite', store => {
    store.delete(id)
  })
}
