import type { ApiResponse, LogEntry, TaskState } from '@shared/types'

declare global {
  interface Window {
    kdAPI: {
      /** 白名单式 invoke，返回统一 ApiResponse */
      invoke: (channel: string, payload?: unknown) => Promise<unknown>
      /** 订阅任务状态流 kd:event:task，返回取消订阅函数 */
      onTask: (cb: (state: TaskState) => void) => () => void
      /** 订阅日志流 kd:event:log，返回取消订阅函数 */
      onLog: (cb: (entry: LogEntry) => void) => () => void
    }
  }
}

export {}
