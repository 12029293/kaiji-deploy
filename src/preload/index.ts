/**
 * preload：contextBridge 暴露类型化 kdAPI（invoke 白名单 + 事件订阅）。
 * 渲染进程无 Node 能力，安全边界清晰（ARCH §1.3）。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  IPC,
  type LogEntry,
  type TaskState
} from '@shared/types'

type Unsubscribe = () => void

const kdAPI = {
  /** 白名单式 invoke（返回统一 ApiResponse） */
  invoke: (channel: string, payload?: unknown): Promise<unknown> => {
    if (!INVOKE_CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`非法 IPC 通道: ${channel}`))
    }
    return ipcRenderer.invoke(channel, payload)
  },

  /** 订阅任务状态流 kd:event:task */
  onTask: (callback: (state: TaskState) => void): Unsubscribe => {
    const listener = (_e: IpcRendererEvent, state: TaskState): void => callback(state)
    ipcRenderer.on(IPC.EVENT_TASK, listener)
    return () => ipcRenderer.removeListener(IPC.EVENT_TASK, listener)
  },

  /** 订阅日志流 kd:event:log */
  onLog: (callback: (entry: LogEntry) => void): Unsubscribe => {
    const listener = (_e: IpcRendererEvent, entry: LogEntry): void => callback(entry)
    ipcRenderer.on(IPC.EVENT_LOG, listener)
    return () => ipcRenderer.removeListener(IPC.EVENT_LOG, listener)
  }
}

// 事件通道常量仅供类型层校验引用
void EVENT_CHANNELS

contextBridge.exposeInMainWorld('kdAPI', kdAPI)

export type KdAPI = typeof kdAPI
