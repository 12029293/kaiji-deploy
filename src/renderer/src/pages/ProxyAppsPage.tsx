/**
 * 翻墙软件：Clash Verge 本地包 + 3 个 GitHub 项目。
 * 代理设置与顶栏「代理加速」开关共享 store（同一份持久化配置）。
 */
import { useEffect, useState } from 'react'
import { IPC, type ReleaseInfo } from '@shared/types'
import { call } from '../api'
import { useTasksStore } from '../store/tasksStore'
import { useProxyStore } from '../store/proxyStore'
import { useUiStore } from '../store/uiStore'
import AppCard from '../components/AppCard'
import { Icon } from '../components/Icons'
import Toggle from '../components/Toggle'

export default function ProxyAppsPage(): JSX.Element {
  const byCategory = useTasksStore((s) => s.byCategory)
  const toast = useUiStore((s) => s.toast)
  const proxy = useProxyStore((s) => s.settings)
  const patchProxy = useProxyStore((s) => s.patch)
  const [host, setHost] = useState(proxy.host)
  const [port, setPort] = useState(String(proxy.port))
  const [releases, setReleases] = useState<ReleaseInfo[] | null>(null)
  const [fetching, setFetching] = useState(false)
  const list = byCategory('proxy')

  useEffect(() => {
    setHost(proxy.host)
    setPort(String(proxy.port))
  }, [proxy.host, proxy.port])

  const saveProxy = async (): Promise<void> => {
    try {
      const next = await patchProxy({ host, port: Number(port) || 0 })
      toast(next.enabled ? `代理已启用 ${next.host}:${next.port}` : '代理地址已保存（当前未启用）', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const fetchReleases = async (): Promise<void> => {
    setFetching(true)
    try {
      const res = await call<ReleaseInfo[]>(IPC.PROXY_FETCH_RELEASES)
      setReleases(res)
      const failed = res.filter((r) => r.error)
      toast(
        failed.length === 0
          ? `已获取 ${res.length} 个项目最新 Release`
          : `${res.length - failed.length} 成功 / ${failed.length} 失败（GitHub 不可达时可开启代理后重试）`,
        failed.length === 0 ? 'success' : 'error'
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setFetching(false)
    }
  }

  const field =
    'rounded-[10px] border border-white/[0.12] bg-black/25 px-[11px] py-[7px] text-xs text-white outline-none transition-colors focus:border-accent/60'

  return (
    <div className="kd-fade-in mx-auto max-w-[1400px]">
      <div className="mb-[14px] flex items-baseline gap-[10px]">
        <h3 className="text-[14px] font-semibold text-white">翻墙软件</h3>
        <p className="text-xs text-dim">
          {list.length} 项 · 代理内核与工作台，跟随最新 Release
        </p>
        <span className="flex-1" />
        <button
          type="button"
          className="kd-mini-btn"
          onClick={() => void fetchReleases()}
          disabled={fetching}
        >
          <Icon name="refresh" size={13} />
          {fetching ? '拉取中…' : '检查最新 Release'}
        </button>
      </div>

      {/* 代理设置 */}
      <div className="kd-toolcard mb-4">
        <div className="kd-tool-row">
          <Toggle
            on={proxy.enabled}
            onChange={(v) => {
              patchProxy({ enabled: v })
                .then((s) => toast(s.enabled ? `代理加速已开启（${s.host}:${s.port}）` : '代理已关闭（直连）', s.enabled ? 'success' : 'info'))
                .catch((err) => toast(err instanceof Error ? err.message : String(err), 'error'))
            }}
          />
          <div className="flex-1">
            <b className="block text-[13px] font-semibold text-white">启用下载代理</b>
            <small className="text-[11.5px] text-dim">
              仅作用于 GitHub / 外网请求；直连超时自动回退，不影响国内镜像
            </small>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="127.0.0.1"
              className={`${field} w-[150px] font-mono`}
            />
            <span className="text-dim">:</span>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="7897"
              className={`${field} w-[80px] font-mono`}
            />
            <button type="button" className="kd-mini-btn" onClick={() => void saveProxy()}>
              保存
            </button>
          </div>
        </div>
      </div>

      {releases && (
        <div className="kd-toolcard mb-4">
          {releases.map((r, i) => (
            <div
              key={r.id}
              className={`flex items-center justify-between py-2 ${
                i === releases.length - 1 ? '' : 'border-b border-white/[0.06]'
              }`}
            >
              <span className="text-xs font-medium text-white">{r.name}</span>
              {r.error ? (
                <span className="max-w-[60%] truncate text-xs text-bad" title={r.error}>
                  {r.error}
                </span>
              ) : (
                <span className="text-xs text-dim">
                  {r.latestVersion} · {r.assets.length} 个资产
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
      >
        {list.map((cfg, i) => (
          <AppCard key={cfg.id} cfg={cfg} index={i} />
        ))}
      </div>
    </div>
  )
}
