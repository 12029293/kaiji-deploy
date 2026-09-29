/**
 * UI 局部状态：侧栏折叠、日志抽屉、Toast、二次确认弹窗（危险操作）。
 * 视觉重构后：日志改为底部抽屉，默认收起（由 Dock「日志」按钮唤出）。
 */
import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error' | 'warn'

export interface ToastItem {
  id: number
  kind: ToastKind
  text: string
  /** 退场动画标记（先置位再移除） */
  closing?: boolean
}

export interface ConfirmOptions {
  title: string
  message: string
  danger?: boolean
  confirmText?: string
  onConfirm: () => void | Promise<void>
}

interface UiStoreStateFull {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  logOpen: boolean
  setLogOpen: (open: boolean) => void
  toasts: ToastItem[]
  toast: (text: string, kind?: ToastKind) => void
  dismissToast: (id: number) => void
  confirmOpen: boolean
  confirmOptions: ConfirmOptions | null
  requestConfirm: (options: ConfirmOptions) => void
  closeConfirm: () => void
  onboardingOpen: boolean
  setOnboardingOpen: (open: boolean) => void
}

let toastSeq = 1

export const useUiStore = create<UiStoreStateFull>()((set, get) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  logOpen: false,
  setLogOpen: (open) => set({ logOpen: open }),

  toasts: [],
  toast: (text, kind = 'info') => {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    window.setTimeout(() => {
      // 先标记退场（0.3s 滑出），再从列表移除
      set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, closing: true } : t)) }))
      window.setTimeout(() => get().dismissToast(id), 320)
    }, 3200)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  confirmOpen: false,
  confirmOptions: null,
  requestConfirm: (options) => set({ confirmOpen: true, confirmOptions: options }),
  closeConfirm: () => set({ confirmOpen: false, confirmOptions: null }),

  onboardingOpen: false,
  setOnboardingOpen: (open) => set({ onboardingOpen: open })
}))
