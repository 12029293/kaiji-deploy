/**
 * 日志流订阅与缓冲（保留最近 1000 条，P2-3 导出 txt）。
 */
import { create } from 'zustand'
import { IPC, type LogEntry } from '@shared/types'
import { call } from '../api'

const MAX_ENTRIES = 1000

interface LogStoreState {
  entries: LogEntry[]
  init: () => void
  push: (entry: LogEntry) => void
  clear: () => void
  /** 导出日志 txt，返回保存路径（取消返回空串） */
  exportLog: () => Promise<string>
}

export const useLogStore = create<LogStoreState>()((set, get) => ({
  entries: [],

  init: () => {
    window.kdAPI.onLog((entry) => get().push(entry))
  },

  push: (entry) => {
    set((s) => {
      const next = [...s.entries, entry]
      return { entries: next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next }
    })
  },

  clear: () => set({ entries: [] }),

  exportLog: async (): Promise<string> => {
    const res = await call<{ path: string }>(IPC.LOG_EXPORT)
    return res.path
  }
}))
