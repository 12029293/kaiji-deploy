/**
 * 代理设置（顶栏「代理加速」开关 + 翻墙软件页的 host/port 表单共享）。
 * 仅作用于 GitHub / 外网请求，直连超时自动回退。
 */
import { create } from 'zustand'
import { IPC, type ProxySettings } from '@shared/types'
import { call } from '../api'

interface ProxyState {
  settings: ProxySettings
  loaded: boolean
  load: () => Promise<void>
  patch: (patch: Partial<ProxySettings>) => Promise<ProxySettings>
}

export const useProxyStore = create<ProxyState>()((set, get) => ({
  settings: { enabled: false, host: '127.0.0.1', port: 7897 },
  loaded: false,

  load: async () => {
    try {
      const s = await call<ProxySettings>(IPC.PROXY_GET_SETTINGS)
      set({ settings: s, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  patch: async (patchValue) => {
    const next = { ...get().settings, ...patchValue }
    set({ settings: next })
    const saved = await call<ProxySettings>(IPC.PROXY_SET_SETTINGS, next)
    set({ settings: saved })
    return saved
  }
}))
