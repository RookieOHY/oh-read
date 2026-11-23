/**
 * 本地存储层 —— 基于 IndexedDB
 *
 * 设计要点：
 * - 书籍文件以 Blob 存入 IndexedDB，由浏览器负责磁盘化存储与内存回收，
 *   应用进程里不会长期持有整本书的内容（内存优先约束）。
 * - 所有操作均为异步（Promise），UI 层不感知 IndexedDB 细节。
 * - 读写完成后立即 close()，避免连接长期占用。
 * - 列表查询（listBooks）只投影元数据字段，**不拉取文件本体**；
 *   阅读时用 getBook(id) 按需取完整记录。
 */

import type { BookMetaLite, BookRecord, TxtChapter } from './Book'

/** 数据库名与版本（结构变更时递增 DB_VERSION 并在 onupgradeneeded 里做迁移） */
const DB_NAME = 'oread'
const DB_VERSION = 3
/** 书籍表名 */
const BOOK_STORE = 'books'
/** TXT 章节切分缓存表（key = 内容指纹 hash） */
const TXT_CACHE_STORE = 'txtCache'

/** 打开数据库（首次运行时自动建表） */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    // 数据库首次创建 / 版本升级时触发，负责建表和索引
    // 统一逻辑：无论新建还是升级，都保证表与索引齐全
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.objectStoreNames.contains(BOOK_STORE)
        ? request.transaction!.objectStore(BOOK_STORE)
        : db.createObjectStore(BOOK_STORE, { keyPath: 'id' })
      // addedAt：按导入时间查询；hash：内容指纹去重
      if (!store.indexNames.contains('addedAt')) {
        store.createIndex('addedAt', 'addedAt')
      }
      if (!store.indexNames.contains('hash')) {
        store.createIndex('hash', 'hash', { unique: false })
      }
      // v3：TXT 章节缓存（避免每次打开全量重新切分）
      if (!db.objectStoreNames.contains(TXT_CACHE_STORE)) {
        db.createObjectStore(TXT_CACHE_STORE)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * 在事务里执行一次操作的小工具：完成后自动关库。
 *
 * 泛型约定：run 必须返回 IDBRequest<T>（IndexedDB 的所有操作都返回 request），
 * 事务完成后把 request.result 交给 postProcess 处理并 resolve。
 */
function withTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
  postProcess?: (result: T) => T,
): Promise<T> {
  return openDB().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(BOOK_STORE, mode)
        const store = tx.objectStore(BOOK_STORE)
        const request = run(store)
        tx.oncomplete = () => {
          db.close()
          resolve(postProcess ? postProcess(request.result) : request.result)
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
      }),
  )
}

/** 在事务里执行一次操作的小工具（用于 books 之外的表，如 txtCache） */
function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const request = run(tx.objectStore(storeName))
        tx.oncomplete = () => {
          db.close()
          resolve(request.result)
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
  await withTransaction('readwrite', store => store.add(record))
}

/**
 * 读取书架列表（轻量投影，不含文件本体；按导入时间倒序：最新导入的排最前）。
 * 注意：返回值里的 cover 仍是 Blob（书架封面显示需要），
 * IndexedDB 的 Blob 是磁盘 backed 对象，读取不会整块进内存。
 */
export async function listBooks(): Promise<BookMetaLite[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOK_STORE, 'readonly')
    const out: BookMetaLite[] = []
    const request = tx.objectStore(BOOK_STORE).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        db.close()
        out.sort((a, b) => b.addedAt - a.addedAt)
        resolve(out)
        return
      }
      // 投影：只挑列表展示所需字段，file Blob 不进列表
      const r = cursor.value as BookRecord
      out.push({
        id: r.id,
        hash: r.hash,
        title: r.title,
        author: r.author,
        format: r.format,
        cover: r.cover,
        fileName: r.fileName,
        addedAt: r.addedAt,
      })
      cursor.continue()
    }
    request.onerror = () => {
      db.close()
      reject(request.error)
    }
  })
}

/** 按完整记录读取一本书（阅读视图打开时用；含文件本体） */
export async function getBook(id: string): Promise<BookRecord | null> {
  const record = await withTransaction<BookRecord | undefined>('readonly', store => store.get(id))
  return record ?? null
}

/** 删除一本书 */
export async function deleteBook(id: string): Promise<void> {
  await withTransaction('readwrite', store => store.delete(id))
}

/** 按内容指纹查询一本书（导入去重用；不存在时返回 null） */
export async function getBookByHash(hash: string): Promise<BookRecord | null> {
  const list = await withTransaction<BookRecord[]>(
    'readonly',
    store => store.index('hash').getAll(hash),
    result => result,
  )
  return list?.[0] ?? null
}

// ---------------------------------------------------------------------------
// TXT 章节切分缓存（key = 内容指纹 hash）
// ---------------------------------------------------------------------------

/** 保存 TXT 章节切分结果（打开时切分一次，之后直接读缓存） */
export async function saveTxtCache(hash: string, chapters: TxtChapter[]): Promise<void> {
  await withStore(TXT_CACHE_STORE, 'readwrite', store => store.put(chapters, hash))
}

/** 读取 TXT 章节切分缓存（未切分过时返回 null） */
export async function loadTxtCache(hash: string): Promise<TxtChapter[] | null> {
  const cached = await withStore<TxtChapter[] | undefined>(
    TXT_CACHE_STORE,
    'readonly',
    store => store.get(hash),
  )
  return cached ?? null
}
