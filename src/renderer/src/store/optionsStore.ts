/**
 * 全局安装选项（桌面快捷方式 / 开机启动）—— 顶栏与 Dock 的开关共享同一份状态，
 * 天然成对联动（对齐原型 pairSwitch 行为），写入经 OPTIONS_SET 持久化。
 */
import { create } from 'zustand'
import { IPC, type InstallOptions } from '@shared/types'
import { call } from '../api'

interface OptionsState {
  options: InstallOptions
  loaded: boolean
  load: () => Promise<void>
  patch: (patch: Partial<InstallOptions>) => Promise<void>
}

export const useOptionsStore = create<OptionsState>()((set, get) => ({
  options: { createShortcut: true, setAutostart: false },
  loaded: false,

  load: async () => {
    try {
      const o = await call<InstallOptions>(IPC.OPTIONS_GET)
      set({ options: o, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  patch: async (patchValue) => {
    const prev = get().options
    const next = { ...prev, ...patchValue }
    set({ options: next })
    try {
      const saved = await call<InstallOptions>(IPC.OPTIONS_SET, next)
      set({ options: saved })
    } catch (err) {
      set({ options: prev })
      throw err
    }
  }
}))
