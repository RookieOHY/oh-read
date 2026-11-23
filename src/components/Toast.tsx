/**
 * 底部轻量提示条（toast）
 *
 * 两种语义，驻留时长不同：
 * - info：导入结果汇总等，3 秒自动消失
 * - undo：删除撤销，8 秒窗口（软删除的暂存与此时长绑定，见 App 的 effect）
 *
 * 拆成独立组件并区分 kind，是为了避免"导入 toast 覆盖删除撤销窗口"
 * 这类共用单一状态引发的多定时器竞态。
 */

import type { ReactNode } from 'react'

export interface ToastState {
  kind: 'info' | 'undo'
  text: string
}

interface Props {
  toast: ToastState | null
  /** 撤销回调（kind === 'undo' 时显示按钮） */
  onUndo: () => void
}

export default function Toast({ toast, onUndo }: Props): ReactNode {
  if (!toast) return null
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{toast.text}</span>
      {toast.kind === 'undo' && (
        <button className="toast-action" onClick={onUndo}>
          撤销
        </button>
      )}
    </div>
  )
}

/** 按语义返回驻留时长：撤销窗口 8 秒，普通提示 3 秒 */
export function toastDuration(toast: ToastState | null): number {
  return toast?.kind === 'undo' ? 8000 : 3000
}
