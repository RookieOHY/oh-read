/**
 * 根级错误边界
 *
 * 背景：曾发生渲染期异常导致整页白屏的事故（onKey 作用域错误）。
 * ErrorBoundary 捕获子树渲染错误，把"白屏"降级为"可见的错误页 + 恢复入口"。
 *
 * 注意：ErrorBoundary 只捕获渲染期错误（React 渲染阶段），
 * 事件回调与异步任务中的错误仍需各自的 try/catch。
 */

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    // 保留完整堆栈到控制台，方便开发者定位
    console.error('渲染异常（ErrorBoundary 捕获）：', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <h1>应用出现异常</h1>
          <pre className="error-boundary-detail">{this.state.error.message}</pre>
          <div className="error-boundary-actions">
            {/* 重试：清掉错误状态，React 会重新渲染子树 */}
            <button onClick={() => this.setState({ error: null })}>重试</button>
            {/* 重新加载：整页刷新（不清数据，进度与书架都在） */}
            <button onClick={() => window.location.reload()}>重新加载</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
