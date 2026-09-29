/**
 * 左侧导航（7 模块）：品牌区 + 导航项（含软件项计数）+ 底部收起。
 * 视觉对齐原型 nav：深海军蓝玻璃、激活项左侧渐变竖条、可折叠为 64px 图标栏。
 */
import { NavLink } from 'react-router-dom'
import { Icon } from './Icons'
import { ROUTES } from '../routes'
import { useTasksStore } from '../store/tasksStore'
import { useUiStore } from '../store/uiStore'

export default function Sidebar(): JSX.Element {
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggle = useUiStore((s) => s.toggleSidebar)
  const configs = useTasksStore((s) => s.configs)

  const countOf = (category?: string): number =>
    category ? configs.filter((c) => c.category === category).length : 0

  return (
    <nav
      className={`flex shrink-0 flex-col overflow-hidden border-r border-white/[0.06] transition-[width] duration-300 ${
        collapsed ? 'w-16' : 'w-[212px]'
      }`}
      style={{ background: 'rgba(11,18,32,.72)', backdropFilter: 'blur(14px)' }}
    >
      <div className="flex items-center gap-[10px] px-3.5 pb-3.5 pt-4">
        <div
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] text-white"
          style={{
            background: 'var(--kd-grad)',
            boxShadow: '0 4px 14px rgba(34,211,238,.35)'
          }}
        >
          <Icon name="logo" size={20} strokeWidth={1.7} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold tracking-[.02em] text-white">
              开机部署助手
            </h1>
            <p className="-mt-[3px] truncate text-[11px] text-dim">部署控制台 v1.0</p>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {ROUTES.map((r) => (
          <NavLink
            key={r.path}
            to={r.path}
            end={r.path === '/'}
            title={r.label}
            className={({ isActive }) =>
              `kd-nav-item ${isActive ? 'active' : ''} ${collapsed ? 'justify-center' : ''}`
            }
          >
            <span className="shrink-0">
              <Icon name={r.icon} size={17} />
            </span>
            {!collapsed && <span className="truncate">{r.label}</span>}
            {!collapsed && countOf(r.category) > 0 && <span className="cnt">{countOf(r.category)}</span>}
          </NavLink>
        ))}
      </div>

      <button
        type="button"
        onClick={toggle}
        title={collapsed ? '展开导航' : '收起导航'}
        className={`m-2 flex items-center gap-[10px] whitespace-nowrap rounded-[10px] px-2.5 py-[9px] text-dim transition-colors hover:bg-white/[0.05] hover:text-white ${
          collapsed ? 'justify-center' : ''
        }`}
      >
        <span
          className="transition-transform duration-300"
          style={{ transform: collapsed ? 'rotate(180deg)' : 'none' }}
        >
          <Icon name="chevronL" size={16} />
        </span>
        {!collapsed && <span className="text-xs">收起导航</span>}
      </button>
    </nav>
  )
}
