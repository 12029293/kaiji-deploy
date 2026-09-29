/**
 * 概览仪表盘：系统信息 + 管理员状态 + 各模块完成度（P1-5）。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IPC, type SystemInfo } from '@shared/types'
import { call } from '../api'
import { useTasksStore } from '../store/tasksStore'
import { useUiStore } from '../store/uiStore'
import ProgressBar from '../components/ProgressBar'
import { Icon, type IconName } from '../components/Icons'

const MODULES: Array<{
  path: string
  title: string
  desc: string
  category: 'devenv' | 'daily' | 'proxy'
  icon: IconName
}> = [
  {
    path: '/devenv',
    title: '开发环境',
    desc: 'Go / Git / Python / Node.js / FFmpeg 静默安装与版本校验（C 盘）',
    category: 'devenv',
    icon: 'terminal'
  },
  {
    path: '/daily',
    title: '日常软件',
    desc: '20 项常用软件批量勾选安装（统一装到 D 盘），失败自动降级向导',
    category: 'daily',
    icon: 'grid'
  },
  {
    path: '/proxy',
    title: '翻墙软件',
    desc: 'Clash Verge 本地包 + 3 个 GitHub 项目 Release 部署（装到 D 盘）',
    category: 'proxy',
    icon: 'globe'
  }
]

const ENTRIES: Array<{ path: string; title: string; desc: string; icon: IconName }> = [
  { path: '/edge', title: '浏览器定制', desc: '收藏夹导入 · 深色主题 · 下载位置改为桌面', icon: 'brush' },
  { path: '/tools', title: '系统工具', desc: '删角标 · 图标缓存 · 磁贴美化 · 激活 · 禁用更新', icon: 'gear' },
  { path: '/wallpaper', title: '壁纸', desc: 'Wallhaven 在线图库一键设为桌面，支持分页浏览', icon: 'image' }
]

export default function OverviewPage(): JSX.Element {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const toast = useUiStore((s) => s.toast)
  const categorySummary = useTasksStore((s) => s.categorySummary)

  useEffect(() => {
    call<SystemInfo>(IPC.SYSTEM_INFO)
      .then(setInfo)
      .catch((err) => toast(err instanceof Error ? err.message : String(err), 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tiles = [
    { label: '操作系统', value: info?.os ?? '读取中…', tone: 'text-white' },
    { label: '架构', value: info?.arch ?? '-', tone: 'text-white' },
    {
      label: '管理员权限',
      value: info === null ? '…' : info.isAdmin ? '已提权' : '未提权（功能受限）',
      tone: info?.isAdmin ? 'text-ok' : 'text-bad'
    },
    { label: '桌面路径', value: info?.desktopPath ?? '-', tone: 'text-white' }
  ]

  return (
    <div className="kd-fade-in mx-auto max-w-[1400px] space-y-4">
      {/* 系统信息 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="kd-toolcard !p-4">
            <div className="text-xs text-dim">{t.label}</div>
            <div className={`mt-1 truncate text-sm font-semibold ${t.tone}`} title={String(t.value)}>
              {t.value}
            </div>
          </div>
        ))}
      </div>

      {info && !info.isAdmin && (
        <div className="flex items-center gap-2 rounded-[16px] border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          <Icon name="alert" size={15} />
          当前未以管理员身份运行：删角标、禁用更新、Edge 定制等系统级功能可能失败。请右键「以管理员身份运行」。
        </div>
      )}

      {/* 模块完成度 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {MODULES.map((m) => {
          const s = categorySummary(m.category)
          return (
            <Link
              key={m.path}
              to={m.path}
              className="kd-toolcard kd-card-hover !p-5 no-underline"
            >
              <div className="flex items-start gap-3">
                <div
                  className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] text-white"
                  style={{
                    background:
                      'linear-gradient(135deg,rgba(34,211,238,.25),rgba(99,102,241,.25))',
                    border: '1px solid var(--kd-line-strong)'
                  }}
                >
                  <Icon name={m.icon} size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14px] font-semibold text-white">{m.title}</h3>
                  <p className="mt-0.5 min-h-[36px] text-xs leading-[18px] text-dim">{m.desc}</p>
                </div>
                <span className="kd-num shrink-0 text-2xl font-bold leading-none text-white">
                  {s.percent}
                  <span className="text-sm text-dim">%</span>
                </span>
              </div>
              <div className="mt-3">
                <ProgressBar value={s.percent} />
                <div className="mt-1.5 text-[11px] text-dim">
                  {s.success} / {s.total} 完成
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {/* 其他模块入口 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {ENTRIES.map((m) => (
          <Link key={m.path} to={m.path} className="kd-toolcard kd-card-hover !p-5 no-underline">
            <div className="flex items-center gap-[10px]">
              <span className="text-accent">
                <Icon name={m.icon} size={17} />
              </span>
              <h3 className="text-[14px] font-semibold text-white">{m.title}</h3>
            </div>
            <p className="mt-2 text-xs leading-[18px] text-dim">{m.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
