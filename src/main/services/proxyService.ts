/**
 * 翻墙软件服务：GitHub releases/latest 拉取 + 资产匹配 + 代理设置（P0-4）。
 * 代理经 undici ProxyAgent 生效于 fetchJson（downloader），配置持久化 settings.json。
 */
import { fetchJson } from '../core/downloader'
import { settings } from '../core/settings'
import { logger } from '../core/logger'
import { proxyAppsConfigs } from '../config/proxyApps.config'
import type { ProxySettings, ReleaseAsset, ReleaseInfo } from '@shared/types'

interface GithubRelease {
  tag_name: string
  assets: Array<{ name: string; size: number; browser_download_url: string }>
}

class ProxyService {
  getSettings(): ProxySettings {
    return { ...settings.get().proxy }
  }

  setSettings(patch: Partial<ProxySettings>): ProxySettings {
    const next = { ...this.getSettings(), ...patch }
    settings.set({ proxy: next })
    logger.info('proxy', `代理设置已更新: enabled=${next.enabled} ${next.host}:${next.port}`)
    return next
  }

  /** 拉取三个 GitHub 项目最新 Release（逐项容错，失败项返回 error 字段） */
  async fetchReleases(): Promise<ReleaseInfo[]> {
    const targets = proxyAppsConfigs.filter((c) => c.source.kind === 'github-release')
    return Promise.all(
      targets.map(async (cfg): Promise<ReleaseInfo> => {
        try {
          const rel = await this.fetchGithubRelease(cfg.source.repo ?? '')
          const assets: ReleaseAsset[] = rel.assets.map((a) => ({
            name: a.name,
            size: a.size,
            url: a.browser_download_url
          }))
          logger.info('proxy', `${cfg.name} 最新版本 ${rel.tag_name}（${assets.length} 个资产）`)
          return { id: cfg.id, name: cfg.name, latestVersion: rel.tag_name, assets }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.error('proxy', `${cfg.name} Release 拉取失败: ${msg}`)
          return { id: cfg.id, name: cfg.name, latestVersion: '', assets: [], error: msg }
        }
      })
    )
  }

  /** GitHub API releases/latest（走全局代理设置） */
  async fetchGithubRelease(repo: string): Promise<GithubRelease> {
    if (!repo) throw new Error('GitHub 仓库未配置')
    return fetchJson<GithubRelease>(`https://api.github.com/repos/${repo}/releases/latest`)
  }

  /**
   * 引擎用：匹配仓库最新 Release 资产。
   * 匹配 assetPattern 后按 exe > msi > zip 优先级择优。
   */
  async resolveGithubAsset(
    repo: string,
    assetPattern: string,
    _proxyUrl: string | null
  ): Promise<{ url: string; filename: string }> {
    const rel = await this.fetchGithubRelease(repo)
    const re = new RegExp(assetPattern, 'i')
    const matched = rel.assets.filter((a) => re.test(a.name))
    if (matched.length === 0) {
      throw new Error(`${repo} 最新 Release 无匹配资产（规则: ${assetPattern}）`)
    }
    const score = (n: string): number =>
      /\.exe$/i.test(n) ? 0 : /\.msi$/i.test(n) ? 1 : /\.zip$/i.test(n) ? 2 : 3
    matched.sort((a, b) => score(a.name) - score(b.name))
    return { url: matched[0].browser_download_url, filename: matched[0].name }
  }
}

export const proxyService = new ProxyService()

/** 引擎导入用的薄包装（避免 engine 直接依赖 service 实例的循环引用风险） */
export async function resolveGithubAsset(
  repo: string,
  assetPattern: string,
  proxyUrl: string | null
): Promise<{ url: string; filename: string }> {
  return proxyService.resolveGithubAsset(repo, assetPattern, proxyUrl)
}
