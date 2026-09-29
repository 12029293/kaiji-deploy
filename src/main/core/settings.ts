/**
 * 设置持久化（userData/settings.json）：
 * 代理配置、首次引导标记、部署方案（P2-1）、下载缓存开关（P2-2）。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ProxySettings } from '@shared/types'
import { logger } from './logger'

export interface AppSettings {
  proxy: ProxySettings
  onboardingDone: boolean
  cacheEnabled: boolean
  /** 部署方案：configId → 是否勾选 */
  plan: Record<string, boolean>
  /** 安装/解压完成后创建桌面快捷方式（v1.0.2，默认 true） */
  createShortcut: boolean
  /** 是否写入开机自启（v1.0.2，默认 false——用户明确要求不设开机启动） */
  setAutostart: boolean
}

const DEFAULTS: AppSettings = {
  proxy: { enabled: false, host: '127.0.0.1', port: 7897 },
  onboardingDone: false,
  cacheEnabled: true,
  plan: {},
  createShortcut: true,
  setAutostart: false
}

class Settings {
  private data: AppSettings = { ...DEFAULTS, proxy: { ...DEFAULTS.proxy }, plan: {} }
  private filePath = ''

  init(userDataDir: string): void {
    this.filePath = path.join(userDataDir, 'settings.json')
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<AppSettings>
        this.data = {
          ...DEFAULTS,
          ...raw,
          proxy: { ...DEFAULTS.proxy, ...(raw.proxy ?? {}) },
          plan: { ...(raw.plan ?? {}) }
        }
      }
    } catch (err) {
      logger.warn('settings', `settings.json 读取失败，已重置: ${String(err)}`)
    }
  }

  get(): AppSettings {
    return this.data
  }

  /** 合并写入并持久化 */
  set(patch: Partial<AppSettings>): AppSettings {
    this.data = {
      ...this.data,
      ...patch,
      proxy: { ...this.data.proxy, ...(patch.proxy ?? {}) },
      plan: { ...this.data.plan, ...(patch.plan ?? {}) }
    }
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch (err) {
      logger.error('settings', `settings.json 写入失败: ${String(err)}`)
    }
    return this.data
  }

  /** 代理 url 形式（enabled=false 时返回 null，downloader 直连） */
  proxyUrl(): string | null {
    const p = this.data.proxy
    return p.enabled ? `http://${p.host}:${p.port}` : null
  }
}

export const settings = new Settings()
