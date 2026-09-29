/**
 * 系统工具磁贴（P0-10 / P1-3）：删角标 4 功能 / 图标缓存重建 / 磁贴美化 / 系统激活 / 更新开关。
 * 危险操作经 ConfirmDialog 二次确认（ARCH 共享知识 #6）。
 */
import { useState } from 'react'
import { IPC, type ToolAction } from '@shared/types'
import { call } from '../api'
import { useUiStore } from '../store/uiStore'
import { Icon, type IconName } from '../components/Icons'

interface ToolTile {
  tool: ToolAction
  title: string
  desc: string
  icon: IconName
  danger?: boolean
  confirm?: { title: string; message: string }
}

const TILES: ToolTile[] = [
  {
    tool: 'badge-remove',
    title: '去除快捷方式角标',
    desc: '注册表 Shell Icons 29 → 空白图标并刷新（可逆）',
    icon: 'external',
    danger: true,
    confirm: {
      title: '去除快捷方式角标',
      message: '将写入注册表并重启 explorer.exe（桌面会闪烁重载）。可随时用「恢复角标」还原。继续吗？'
    }
  },
  {
    tool: 'shield-remove',
    title: '去除小盾牌',
    desc: '注册表 Shell Icons 29 + 77 → 空白图标并刷新（可逆）',
    icon: 'shield',
    danger: true,
    confirm: {
      title: '去除小盾牌',
      message: '将写入注册表并重启 explorer.exe。可随时用「恢复小盾牌」还原。继续吗？'
    }
  },
  {
    tool: 'badge-restore',
    title: '恢复快捷方式角标',
    desc: '删除注册表 Shell Icons 29 并刷新图标缓存',
    icon: 'refresh',
    danger: true,
    confirm: { title: '恢复快捷方式角标', message: '将删除注册表项并重启 explorer.exe。继续吗？' }
  },
  {
    tool: 'shield-restore',
    title: '恢复小盾牌',
    desc: '删除注册表 Shell Icons 29 + 77 并刷新',
    icon: 'shield',
    danger: true,
    confirm: { title: '恢复小盾牌', message: '将删除注册表项并重启 explorer.exe。继续吗？' }
  },
  {
    tool: 'rebuild-icon-cache',
    title: '新图标缓存',
    desc: '重启 explorer + 删 IconCache/thumbcache + 清托盘图标记忆',
    icon: 'layout',
    danger: true,
    confirm: {
      title: '重建图标缓存',
      message:
        '将重启 explorer.exe、删除图标/缩略图缓存数据库并清理托盘图标注册表记忆。桌面与任务栏会短暂消失后恢复。继续吗？'
    }
  },
  {
    tool: 'tiles',
    title: '磁贴美化小工具',
    desc: '启动本地 磁贴美化小工具 v4.1.1（含辅助小工具）',
    icon: 'grid'
  },
  {
    tool: 'activation',
    title: '系统激活',
    desc: '以管理员权限启动本地 系统激活.exe',
    icon: 'zap',
    danger: true,
    confirm: {
      title: '启动系统激活工具',
      message: '将以管理员权限启动本地 系统激活.exe，请在弹出的工具窗口内按提示操作。继续吗？'
    }
  },
  {
    tool: 'disable-update',
    title: '禁用 Windows 更新',
    desc: '启动 Windows Update Blocker（Wub_x64.exe），在工具内选择禁用',
    icon: 'x'
  },
  {
    tool: 'enable-update',
    title: '恢复 Windows 更新',
    desc: '启动 Windows Update Blocker，在工具内选择恢复服务',
    icon: 'check'
  }
]

export default function SystemToolsPage(): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const requestConfirm = useUiStore((s) => s.requestConfirm)
  const [busy, setBusy] = useState<ToolAction | null>(null)

  const run = async (tile: ToolTile): Promise<void> => {
    setBusy(tile.tool)
    try {
      const res = await call<{ ok: boolean; output: string }>(IPC.TOOLS_ACTION, { tool: tile.tool })
      if (res.ok) {
        toast(`${tile.title}：执行完成`, 'success')
      } else {
        toast(`${tile.title}：执行失败（详见日志）`, 'error')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const onClick = (tile: ToolTile): void => {
    if (tile.confirm) {
      requestConfirm({
        title: tile.confirm.title,
        message: tile.confirm.message,
        danger: tile.danger,
        confirmText: '继续执行',
        onConfirm: () => run(tile)
      })
    } else {
      void run(tile)
    }
  }

  return (
    <div className="kd-fade-in mx-auto max-w-[1400px]">
      <div className="mb-[14px] flex items-baseline gap-[10px]">
        <h3 className="text-[14px] font-semibold text-white">系统工具</h3>
        <p className="text-xs text-dim">
          删角标系列已把本地 bat 的交互逻辑翻译为原子命令（参数化 · 可逆 · 无交互）；工具入口引用本地素材
        </p>
      </div>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
      >
        {TILES.map((tile, i) => {
          const running = busy === tile.tool
          return (
            <button
              key={tile.tool}
              type="button"
              disabled={busy !== null}
              onClick={() => onClick(tile)}
              className={`kd-appcard kd-enter text-left ${running ? 'selected' : ''}`}
              style={{
                animationDelay: `${Math.min(i, 12) * 30}ms`,
                opacity: busy !== null && !running ? 0.55 : 1
              }}
            >
              <div className="flex items-start gap-[11px]">
                <div
                  className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px]"
                  style={{
                    background: tile.danger
                      ? 'rgba(248,113,113,.10)'
                      : 'linear-gradient(135deg,rgba(34,211,238,.25),rgba(99,102,241,.25))',
                    border: '1px solid var(--kd-line-strong)',
                    color: tile.danger ? 'var(--kd-err)' : '#fff'
                  }}
                >
                  <Icon name={tile.icon} size={19} />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-[14px] font-semibold leading-[1.3] text-white">
                    {tile.title}
                  </h3>
                  <p className="mt-px text-xs leading-[18px] text-dim">{tile.desc}</p>
                </div>
              </div>
              <div className="mt-[11px] flex items-center gap-2">
                <span className={`kd-pill ${tile.danger ? 'c-warn' : ''}`}>
                  <i />
                  {tile.danger ? '需确认' : '安全'}
                </span>
                <span className="flex-1" />
                <span className="kd-mini-btn">
                  <Icon name={running ? 'refresh' : 'play'} size={13} />
                  {running ? '执行中…' : '执行'}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
