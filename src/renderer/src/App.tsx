/**
 * 应用骨架（部署控制台）：
 * 背景光斑 → 左侧导航 + 顶部状态条 + 主内容区 → 底部悬浮 Dock + 日志抽屉
 * + 危险操作确认弹窗 + 首次引导弹窗 + Toast。
 *
 * 快捷键：Esc 收起日志抽屉 / Ctrl(Cmd)+A 全选本页。
 */
import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { IPC } from '@shared/types'
import { call } from './api'
import { metaOf } from './routes'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import Dock from './components/Dock'
import LogDrawer from './components/LogDrawer'
import ToastHost from './components/ToastHost'
import ConfirmDialog from './components/ConfirmDialog'
import OnboardingModal from './components/OnboardingModal'
import OverviewPage from './pages/OverviewPage'
import DevEnvPage from './pages/DevEnvPage'
import DailyAppsPage from './pages/DailyAppsPage'
import ProxyAppsPage from './pages/ProxyAppsPage'
import BrowserPage from './pages/BrowserPage'
import SystemToolsPage from './pages/SystemToolsPage'
import WallpaperPage from './pages/WallpaperPage'
import { useTasksStore } from './store/tasksStore'
import { useLogStore } from './store/logStore'
import { useOptionsStore } from './store/optionsStore'
import { useProxyStore } from './store/proxyStore'
import { useUiStore } from './store/uiStore'

export default function App(): JSX.Element {
  const setOnboardingOpen = useUiStore((s) => s.setOnboardingOpen)
  const toast = useUiStore((s) => s.toast)
  const { pathname } = useLocation()

  useEffect(() => {
    void (async () => {
      try {
        await useTasksStore.getState().init()
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error')
      }
      useLogStore.getState().init()
      void useOptionsStore.getState().load()
      void useProxyStore.getState().load()
      // 首次打开引导（P1-2）
      try {
        const done = await call<boolean>(IPC.ONBOARD_GET)
        if (!done) setOnboardingOpen(true)
      } catch {
        /* 引导检测失败不阻塞 */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* 快捷键：Esc 收起抽屉；Ctrl/Cmd+A 全选本页 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        useUiStore.getState().setLogOpen(false)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
        const meta = metaOf(pathname)
        if (!meta.category) return
        e.preventDefault()
        const store = useTasksStore.getState()
        const pageIds = store.configs.filter((c) => c.category === meta.category).map((c) => c.id)
        const allOn = pageIds.length > 0 && pageIds.every((id) => store.selected[id])
        store.setSelection(pageIds, !allOn)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pathname])

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-base">
      <div className="kd-blobs" />

      <Sidebar />

      <div className="relative z-[1] flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-[130px] pt-5">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/devenv" element={<DevEnvPage />} />
            <Route path="/daily" element={<DailyAppsPage />} />
            <Route path="/proxy" element={<ProxyAppsPage />} />
            <Route path="/edge" element={<BrowserPage />} />
            <Route path="/tools" element={<SystemToolsPage />} />
            <Route path="/wallpaper" element={<WallpaperPage />} />
            <Route path="*" element={<OverviewPage />} />
          </Routes>
        </main>
      </div>

      <Dock />
      <LogDrawer />

      <ConfirmDialog />
      <OnboardingModal />
      <ToastHost />
    </div>
  )
}
