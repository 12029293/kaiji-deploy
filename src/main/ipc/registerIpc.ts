/**
 * 统一 IPC Handler 注册：invoke 白名单 + 事件转发。
 * 所有 invoke 返回统一 {ok, data?, error?} 包装（ARCH 共享知识 #4）。
 */
import { ipcMain } from 'electron'
import {
  IPC,
  type AppConfigView,
  type EdgeCustomizeOptions,
  type InstallOptions,
  type ProxySettings,
  type SystemInfo,
  type ToolAction
} from '@shared/types'
import { logger } from '../core/logger'
import { taskQueue } from '../core/taskQueue'
import { settings } from '../core/settings'
import { isElevated } from '../core/shellRunner'
import { getDesktopPath } from '../config/paths'
import { appsConfigs } from '../config/apps.config'
import { devEnvConfigs } from '../config/devEnv.config'
import { proxyAppsConfigs } from '../config/proxyApps.config'
import { devEnvService } from '../services/devEnvService'
import { dailyAppsService } from '../services/dailyAppsService'
import { proxyService } from '../services/proxyService'
import { edgeService } from '../services/edgeService'
import { imeService } from '../services/imeService'
import { systemToolsService } from '../services/systemToolsService'
import { wallpaperService } from '../services/wallpaperService'
import { getSystemInfo } from '../services/systemInfoService'
import { wallhavenService } from '../services/wallhavenService'

type Handler = (payload: unknown) => unknown | Promise<unknown>

function sourceHintOf(source: AppConfigView extends never ? never : import('@shared/types').SourceSpec): string {
  switch (source.kind) {
    case 'local-file':
      return '本地安装包'
    case 'direct-url':
      return '官网直链'
    case 'url-resolver':
      return '官网解析'
    case 'github-release':
      return `GitHub ${source.repo ?? ''}`
    case 'none':
      return '官网手动下载'
    default:
      return ''
  }
}

function toConfigViews(): AppConfigView[] {
  return [...devEnvConfigs, ...appsConfigs, ...proxyAppsConfigs].map((cfg) => {
    // 安装位置标注：开发环境默认 C 盘；daily/proxy 统一 D:\Apps；
    // 纯下载项（Geek/IDM破解，silentArgs undefined 且无解压目标）不标安装位置
    const isDownloadOnly = cfg.silentArgs === undefined && !cfg.extractZip
    const locHint = cfg.category === 'devenv' ? ' · C 盘' : isDownloadOnly ? '' : ' · D:\\Apps'
    return {
      id: cfg.id,
      name: cfg.name,
      category: cfg.category,
      homepage: cfg.homepage || undefined,
      degrade: cfg.degrade,
      needsConfirm: cfg.needsConfirm,
      sourceHint: sourceHintOf(cfg.source) + locHint
    }
  })
}

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (_event, payload: unknown) => {
    try {
      const data = await fn(payload)
      return { ok: true, data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('ipc', `${channel} 处理失败: ${msg}`)
      return { ok: false, error: msg }
    }
  })
}

function asRecord(payload: unknown): Record<string, unknown> {
  return (payload ?? {}) as Record<string, unknown>
}

function asStringArray(payload: unknown): string[] {
  const rec = asRecord(payload)
  const ids = rec['configIds'] ?? rec['ids']
  return Array.isArray(ids) ? ids.map(String) : []
}

export function registerIpc(): void {
  // 系统
  handle(IPC.SYSTEM_INFO, async (): Promise<SystemInfo> => {
    const [info, isAdmin] = await Promise.all([getSystemInfo(), isElevated()])
    info.isAdmin = isAdmin
    info.desktopPath = getDesktopPath()
    return info
  })

  // 任务
  handle(IPC.TASKS_RUN, (p) => ({ started: taskQueue.enqueue(asStringArray(p)) }))
  handle(IPC.TASKS_RETRY, (p) => ({ started: taskQueue.retry(asStringArray(p)) }))
  handle(IPC.TASKS_CANCEL, (p) => taskQueue.cancel(String(asRecord(p)['configId'] ?? '')))
  handle(IPC.TASKS_GET_ALL, () => taskQueue.getAll())
  handle(IPC.APPS_GET_CONFIGS, () => toConfigViews())

  // 开发环境
  handle(IPC.DEVENV_VERIFY_ALL, async () => devEnvService.verifyAll())

  // 翻墙软件 / 代理
  handle(IPC.PROXY_GET_SETTINGS, () => proxyService.getSettings())
  handle(IPC.PROXY_SET_SETTINGS, (p) => {
    const rec = asRecord(p)
    const patch: Partial<ProxySettings> = {
      enabled: Boolean(rec['enabled']),
      host: String(rec['host'] ?? ''),
      port: Number(rec['port'] ?? 0)
    }
    return proxyService.setSettings(patch)
  })
  handle(IPC.PROXY_FETCH_RELEASES, async () => proxyService.fetchReleases())

  // Edge 定制
  handle(IPC.EDGE_STATUS, async () => ({ edgeRunning: await edgeService.isEdgeRunning() }))
  handle(IPC.EDGE_CLOSE, async () => edgeService.closeEdge())
  handle(IPC.EDGE_CUSTOMIZE, async (p) => {
    const rec = asRecord(p)
    const opts: EdgeCustomizeOptions = {
      favorites: Boolean(rec['favorites']),
      dark: Boolean(rec['dark']),
      downloadDir: Boolean(rec['downloadDir'])
    }
    return edgeService.customize(opts)
  })
  handle(IPC.EDGE_PREVIEW, async () => edgeService.previewBookmarks())

  // 输入法清理
  handle(IPC.IME_CLEANUP, async () => imeService.cleanup())

  // 系统工具
  handle(IPC.TOOLS_ACTION, async (p) => {
    const rec = asRecord(p)
    return systemToolsService.action(String(rec['tool'] ?? '') as ToolAction)
  })

  // 壁纸
  handle(IPC.WALLPAPER_LIST, () => wallpaperService.list())
  handle(IPC.WALLPAPER_THUMB, (p) => wallpaperService.thumb(String(asRecord(p)['path'] ?? '')))
  handle(IPC.WALLPAPER_SET, async (p) =>
    wallpaperService.setWallpaper(String(asRecord(p)['path'] ?? ''))
  )

  // Wallhaven 在线壁纸（v1.0.9；v1.1.0 起为唯一在线壁纸来源，代理加速开=走代理/关=直连）
  handle(IPC.WALLHAVEN_LIST, (p) => wallhavenService.listPhotos(Number(asRecord(p)['page'] ?? 1)))
  handle(IPC.WALLHAVEN_THUMB, (p) => {
    const rec = asRecord(p)
    return wallhavenService.thumb(String(rec['id'] ?? ''), rec['url'] ? String(rec['url']) : undefined)
  })
  handle(IPC.WALLHAVEN_SET, (p) => {
    const rec = asRecord(p)
    return wallhavenService.downloadAndSet(String(rec['id'] ?? ''), String(rec['url'] ?? ''))
  })

  // 首次引导
  handle(IPC.ONBOARD_GET, () => settings.get().onboardingDone)
  handle(IPC.ONBOARD_DONE, (p) => {
    const reset = Boolean(asRecord(p)['reset'])
    settings.set({ onboardingDone: !reset })
    return settings.get().onboardingDone
  })

  // 部署方案（P2-1）
  handle(IPC.PLAN_SAVE, (p) => {
    const rec = asRecord(p)
    const selections = (rec['selections'] ?? {}) as Record<string, boolean>
    settings.set({ plan: selections })
    return true
  })
  handle(IPC.PLAN_LOAD, () => settings.get().plan)

  // 日志导出（P2-3）
  handle(IPC.LOG_EXPORT, async () => ({ path: await logger.exportTxt() }))

  // 全局安装选项（v1.0.2）：桌面快捷方式 / 开机启动
  handle(IPC.OPTIONS_GET, (): InstallOptions => ({
    createShortcut: settings.get().createShortcut,
    setAutostart: settings.get().setAutostart
  }))
  handle(IPC.OPTIONS_SET, (p): InstallOptions => {
    const rec = asRecord(p)
    const patch: Partial<InstallOptions> = {}
    if (rec['createShortcut'] !== undefined) patch.createShortcut = Boolean(rec['createShortcut'])
    if (rec['setAutostart'] !== undefined) patch.setAutostart = Boolean(rec['setAutostart'])
    settings.set(patch)
    logger.info(
      'options',
      `安装选项更新：快捷方式=${settings.get().createShortcut} 开机启动=${settings.get().setAutostart}`
    )
    return {
      createShortcut: settings.get().createShortcut,
      setAutostart: settings.get().setAutostart
    }
  })

  // dailyAppsService 提供 registerAll（main/index.ts 启动时调用）
  void dailyAppsService
}
