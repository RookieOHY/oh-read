/**
 * 错误格式化小工具
 *
 * catch (err) 里的 err 类型是 unknown：直接 String(err) 对普通对象
 * 会输出 "[object Object]"，对 Error 输出 "Error: xxx"（含类名前缀）。
 * 统一用它拿到人类可读的一句话错误。
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
