/**
 * 软件卡片（对齐原型 .card）：
 * 右上角勾选框 + 选中角标、图标瓦片、名称/来源、**状态区（每态独占形态）**、
 * 底部状态 pill + 行内动作（单独安装 / 重试 / 打开官网）。
 *
 * 状态区六态形态：
 *   checking     骨架 shimmer + 标题扫光（由父级 title-shimmer 负责）
 *   downloading  环形进度（真实 task.progress）+ 文案
 *   installing   不定进度条
 *   verifying    脉冲光圈
 *   success      对勾描线
 *   failed / manual-needed  错误 / 降级提示 + 动作
 */
import { useEffect, useRef, useState } from 'react'
import { IPC, type AppConfigView } from '@shared/types'
import { call } from '../api'
import { CATEGORY_ICON } from '../routes'
import { useTasksStore } from '../store/tasksStore'
import { useUiStore } from '../store/uiStore'
import { DrawCheck, Icon } from './Icons'
import StatusPill from './StatusPill'

/** r=20 的环周长 */
const CIRC = 2 * Math.PI * 20

export default function AppCard({
  cfg,
  index = 0
}: {
  cfg: AppConfigView
  index?: number
}): JSX.Element {
  const task = useTasksStore((s) => s.tasks[cfg.id])
  const checked = Boolean(useTasksStore((s) => s.selected[cfg.id]))
  const toggle = useTasksStore((s) => s.toggle)
  const retry = useTasksStore((s) => s.retry)
  const run = useTasksStore((s) => s.run)
  const toast = useUiStore((s) => s.toast)

  const status = task?.status ?? 'pending'
  const progress = Math.max(0, Math.min(100, task?.progress ?? 0))
  const message = task?.message ?? ''
  const busy =
    status === 'checking' ||
    status === 'downloading' ||
    status === 'installing' ||
    status === 'verifying'

  /* 结局微动效：成功闪一下、失败抖一下（对齐原型 flash-ok / shake） */
  const [flash, setFlash] = useState(false)
  const [shake, setShake] = useState(false)
  const prevStatus = useRef(status)
  useEffect(() => {
    const prev = prevStatus.current
    prevStatus.current = status
    if (prev === status) return
    if (status === 'success') {
      setFlash(true)
      const t = window.setTimeout(() => setFlash(false), 900)
      return () => window.clearTimeout(t)
    }
    if (status === 'failed') {
      setShake(true)
      const t = window.setTimeout(() => setShake(false), 900)
      return () => window.clearTimeout(t)
    }
  }, [status])

  const onRetry = async (): Promise<void> => {
    try {
      await retry([cfg.id])
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const onInstall = async (): Promise<void> => {
    try {
      const started = await run([cfg.id])
      toast(started > 0 ? `已开始部署：${cfg.name}` : `${cfg.name} 已在队列中`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const zone = (): JSX.Element => {
    switch (status) {
      case 'checking':
        return (
          <>
            <div className="kd-hint">
              <span className="kd-spin" />
              解析下载地址…
            </div>
            <div className="kd-sk" style={{ width: '86%' }} />
            <div className="kd-sk" style={{ width: '60%' }} />
          </>
        )
      case 'downloading':
        return (
          <div className="flex items-center gap-[12px]">
            <svg className="kd-ring" viewBox="0 0 48 48">
              <circle className="bg" cx="24" cy="24" r="20" />
              <circle
                className="fg"
                cx="24"
                cy="24"
                r="20"
                strokeDasharray={CIRC}
                strokeDashoffset={CIRC * (1 - progress / 100)}
              />
            </svg>
            <div className="min-w-0">
              <div className="kd-num text-[15px] font-semibold leading-[1.1] text-white">
                {Math.round(progress)}%
              </div>
              <div className="mt-0.5 truncate text-[11px] text-dim" title={message}>
                {message || '正在下载安装包'}
              </div>
            </div>
          </div>
        )
      case 'installing':
        return (
          <>
            <div className="kd-hint">
              <span className="kd-spin" />
              静默安装中…
            </div>
            <div className="kd-bar">
              <i />
            </div>
          </>
        )
      case 'verifying':
        return (
          <div className="kd-hint">
            <span className="kd-pulse" />
            校验安装结果…
          </div>
        )
      case 'success':
        return (
          <div className="kd-hint">
            <DrawCheck />
            <span className="min-w-0 truncate" title={message}>
              安装完成，已就绪
            </span>
          </div>
        )
      case 'failed':
        return (
          <div className="kd-hint" style={{ color: 'var(--kd-err)' }}>
            <Icon name="alert" size={14} />
            <span className="min-w-0 truncate" title={message}>
              {message || '安装失败，可重试'}
            </span>
          </div>
        )
      case 'manual-needed':
        return (
          <div className="kd-hint" style={{ color: 'var(--kd-warn)' }}>
            <Icon name="alert" size={14} />
            <span className="min-w-0 truncate" title={message}>
              {message || '无法全自动完成，需要人工介入'}
            </span>
          </div>
        )
      default:
        return (
          <div className="kd-hint">
            <Icon name="download" size={14} />
            <span className="min-w-0 truncate" title={cfg.sourceHint}>
              待安装
            </span>
          </div>
        )
    }
  }

  const action = (): JSX.Element => {
    if (busy) return <span />
    if (status === 'failed') {
      return (
        <div className="flex items-center gap-2">
          <button type="button" className="kd-mini-btn kd-mini-btn-danger" onClick={() => void onRetry()}>
            <Icon name="refresh" size={13} />
            重试
          </button>
          {cfg.homepage && <HomepageBtn url={cfg.homepage} />}
        </div>
      )
    }
    if (status === 'manual-needed') {
      return (
        <div className="flex items-center gap-2">
          <button type="button" className="kd-mini-btn" onClick={() => void onRetry()}>
            <Icon name="refresh" size={13} />
            重试
          </button>
          {cfg.homepage && <HomepageBtn url={cfg.homepage} />}
        </div>
      )
    }
    if (status === 'success') {
      return cfg.homepage ? <HomepageBtn url={cfg.homepage} /> : <span />
    }
    return (
      <div className="flex items-center gap-2">
        <button type="button" className="kd-mini-btn" onClick={() => void onInstall()}>
          <Icon name="play" size={13} />
          单独安装
        </button>
        {cfg.homepage && <HomepageBtn url={cfg.homepage} />}
      </div>
    )
  }

  const stateClass =
    status === 'success'
      ? 'st-success'
      : status === 'failed'
        ? 'st-failed'
        : status === 'manual-needed'
          ? 'st-manual'
          : ''

  return (
    <article
      className={`kd-appcard kd-enter ${checked ? 'selected' : ''} ${stateClass} ${
        flash ? 'kd-flash-ok' : ''
      } ${shake ? 'kd-shake' : ''}`}
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <label className="kd-sel">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggle(cfg.id)}
          aria-label={`选择 ${cfg.name}`}
        />
        <span className="box">
          <Icon name="check" size={13} strokeWidth={2.4} />
        </span>
      </label>
      <div className="kd-corner">
        <Icon name="check" size={12} strokeWidth={2.6} />
      </div>

      <div className="flex items-start gap-[11px] pr-[30px]">
        <div
          className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] text-white"
          style={{
            background:
              'linear-gradient(135deg,rgba(34,211,238,.25),rgba(99,102,241,.25))',
            border: '1px solid var(--kd-line-strong)'
          }}
        >
          <Icon name={CATEGORY_ICON[cfg.category]} size={19} />
        </div>
        <div className="min-w-0">
          <h3
            className={`truncate text-[14px] font-semibold leading-[1.3] text-white ${
              status === 'checking' ? 'kd-title-shimmer' : ''
            }`}
            title={cfg.name}
          >
            {cfg.name}
          </h3>
          <p className="mt-px truncate text-xs text-dim" title={cfg.sourceHint}>
            {cfg.sourceHint}
            {cfg.needsConfirm && <span className="ml-1.5 text-warn/80">· 需确认</span>}
          </p>
        </div>
      </div>

      <div className="mt-[11px] min-h-[46px]">{zone()}</div>

      <div className="mt-[11px] flex items-center gap-2">
        <StatusPill status={status} />
        <span className="flex-1" />
        {action()}
      </div>
    </article>
  )
}

function HomepageBtn({ url }: { url: string }): JSX.Element {
  return (
    <button
      type="button"
      className="kd-mini-btn"
      title={`打开官网：${url}`}
      onClick={() => window.open(url, '_blank')}
    >
      <Icon name="external" size={13} />
      官网
    </button>
  )
}
