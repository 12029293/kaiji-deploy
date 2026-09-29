/**
 * 概览仪表盘（v1.1.1，docs/ui-concept 概念稿 1:1 对齐）：
 * Hero（徽章 + 大标题 + 双 CTA + 环形仪表/图例）→ 系统信息 statcard → 模块完成度行。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IPC, type SystemInfo } from '@shared/types'
import { call } from '../api'
import { useTasksStore } from '../store/tasksStore'
import { useUiStore } from '../store/uiStore'
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

const R = 80
const CIRC = 2 * Math.PI * R

export default function OverviewPage(): JSX.Element {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const toast = useUiStore((s) => s.toast)
  const setLogOpen = useUiStore((s) => s.setLogOpen)
  const configs = useTasksStore((s) => s.configs)
  const tasks = useTasksStore((s) => s.tasks)
  const categorySummary = useTasksStore((s) => s.categorySummary)

  useEffect(() => {
    call<SystemInfo>(IPC.SYSTEM_INFO)
      .then(setInfo)
      .catch((err) => toast(err instanceof Error ? err.message : String(err), 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* 全局状态计数（三个软件类模块的 29 项） */
  const total = configs.length
  const done = Object.values(tasks).filter((t) => t.status === 'success').length
  const manual = Object.values(tasks).filter((t) => t.status === 'manual-needed').length
  const failed = Object.values(tasks).filter((t) => t.status === 'failed').length
  const idle = Math.max(0, total - done - manual - failed)

  /* 环形仪表三段弧：已就绪(ok) → 需人工+失败(warn) → 待装(sig) */
  const seg = (n: number) => (total ? (CIRC * n) / total : 0)
  const a1 = seg(done)
  const a2 = seg(manual + failed)
  const a3 = seg(idle)

  const statcards = [
    {
      lb: 'SYSTEM',
      vl: info?.osLabel ?? '读取中…',
      sb: info ? `${info.osVersion} · ${info.isAdmin ? '管理员' : '未提权'}` : '…',
      tick: null as number | null
    },
    {
      lb: 'CPU',
      vl:
        info?.cpuCores != null ? `${info.cpuCores} 核 ${info.cpuThreads} 线程` : `${info?.cpuThreads ?? '—'} 线程`,
      sb: info ? `${info.cpuName}${info.cpuClockGHz ? ` · ${info.cpuClockGHz.toFixed(1)} GHz` : ''}` : '…',
      tick: info?.cpuLoad ?? null
    },
    {
      lb: 'MEMORY',
      vl: info ? `${info.memTotalGB} GB` : '…',
      sb: info
        ? `已用 ${info.memUsedGB} GB · 空闲 ${Math.max(0, info.memTotalGB - info.memUsedGB)} GB`
        : '…',
      tick: info ? Math.round((info.memUsedGB / info.memTotalGB) * 100) : null
    },
    {
      lb: 'STORAGE',
      vl: info?.diskFreeGB != null ? `C: ${info.diskFreeGB} GB 可用` : 'C: …',
      sb: info?.diskTotalGB != null && info?.diskUsedPct != null ? `共 ${info.diskTotalGB} GB · 已用 ${info.diskUsedPct}%` : '…',
      tick: info?.diskUsedPct ?? null
    }
  ]

  return (
    <div className="kd-fade-in">
      {/* ===== Hero ===== */}
      <section className="kd-hero">
        <div className="kd-hcopy">
          <div className="kd-hchips">
            <span className="kd-chipx">
              <i />
              {info?.hostname ?? '…'}
            </span>
            <span className="kd-chipx">{info ? `${info.osLabel} · ${info.osVersion.split(' · ')[0]}` : '…'}</span>
            <span className="kd-chipx">共 {total || '…'} 个软件模块</span>
          </div>
          <h1>
            {idle} 项待部署，<em>{done} 项已就绪</em>
          </h1>
          <p className="hsub">
            勾选需要的软件，一次跑完{' '}
            <b style={{ color: 'var(--kd-txt)' }}>解析 → 下载 → 静默安装 → 校验</b>
            。所有下载源在开始前已核验可达，写入前自动备份。
          </p>
          <div className="kd-hact">
            <Link to="/devenv" className="kd-btn-p">
              <Icon name="play" size={15} />
              开始部署
            </Link>
            <button type="button" className="kd-btn-g" onClick={() => setLogOpen(true)}>
              <Icon name="check" size={14} />
              查看运行日志
            </button>
          </div>
        </div>

        <div className="kd-hgauge">
          <div className="kd-ringwrap">
            <svg viewBox="0 0 196 196">
              <circle cx="98" cy="98" r={R} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="11" />
              {a1 > 0 && (
                <circle
                  cx="98" cy="98" r={R} fill="none" stroke="var(--kd-ok)" strokeWidth="11"
                  strokeLinecap="round" strokeDasharray={`${a1} ${CIRC - a1}`} strokeDashoffset={0}
                />
              )}
              {a2 > 0 && (
                <circle
                  cx="98" cy="98" r={R} fill="none" stroke="var(--kd-warn)" strokeWidth="11"
                  strokeLinecap="round" strokeDasharray={`${a2} ${CIRC - a2}`} strokeDashoffset={-a1}
                />
              )}
              {a3 > 0 && (
                <circle
                  cx="98" cy="98" r={R} fill="none" stroke="var(--kd-cyan)" strokeWidth="11"
                  strokeLinecap="round" strokeDasharray={`${a3} ${CIRC - a3}`} strokeDashoffset={-(a1 + a2)}
                />
              )}
            </svg>
            <div className="rv">
              <b className="kd-num">{idle}</b>
              <span>待部署</span>
            </div>
          </div>
          <div className="kd-legend">
            <div className="kd-lg">
              <i style={{ background: 'var(--kd-cyan)' }} />
              待装<b className="kd-num">{idle}</b>
            </div>
            <div className="kd-lg">
              <i style={{ background: 'var(--kd-ok)' }} />
              已就绪<b className="kd-num">{done}</b>
            </div>
            <div className="kd-lg">
              <i style={{ background: 'var(--kd-warn)' }} />
              需人工<b className="kd-num">{manual}</b>
            </div>
            <div className="kd-lg">
              <i style={{ background: 'var(--kd-err)' }} />
              失败<b className="kd-num">{failed}</b>
            </div>
          </div>
        </div>
      </section>

      {/* ===== 系统信息 ===== */}
      <div className="kd-sect" style={{ marginTop: 20 }}>
        <h2>系统信息</h2>
        <span className="ssub">开机自动采集 · 只读</span>
      </div>
      <div className="kd-grid4">
        {statcards.map((c) => (
          <div key={c.lb} className="kd-statcard">
            <div className="lb">{c.lb}</div>
            <div className="vl" title={c.vl}>{c.vl}</div>
            <div className="sb" title={c.sb}>{c.sb}</div>
            {c.tick != null && (
              <div className="tick">
                <i style={{ width: `${Math.min(100, Math.max(2, c.tick))}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {info && !info.isAdmin && (
        <div className="flex items-center gap-2 rounded-[16px] border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          当前未以管理员身份运行：删角标、禁用更新、Edge 定制等系统级功能可能失败。请右键「以管理员身份运行」。
        </div>
      )}

      {/* ===== 模块完成度 ===== */}
      <div className="kd-sect">
        <h2>模块完成度</h2>
        <span className="ssub">点击进入对应模块</span>
        <span className="srt">
          <span className="kd-chipx">
            {done} / {total} 已就绪
          </span>
        </span>
      </div>
      <div className="kd-toolcard" style={{ padding: '8px 6px' }}>
        {MODULES.map((m) => {
          const s = categorySummary(m.category)
          return (
            <Link key={m.path} to={m.path} className="kd-mrow">
              <span className="mic">
                <Icon name={m.icon} size={17} />
              </span>
              <span className="mn">{m.title}</span>
              <span className="ms" title={m.desc}>{m.desc}</span>
              <span className="track">
                <i style={{ width: `${s.percent}%` }} />
              </span>
              <span className="mc">
                {s.success} / {s.total}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
