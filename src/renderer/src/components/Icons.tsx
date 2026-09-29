/**
 * 统一图标集（1.5px 描边线性风格，与原型 console-mockup.html 的 P 表一致）。
 * 禁止 emoji —— 全部使用 SVG，保证跨机器渲染一致。
 */
import type { ReactNode } from 'react'

const PATHS: Record<string, ReactNode> = {
  logo: (
    <>
      <rect x="5" y="8.5" width="14" height="10.5" rx="3.2" />
      <circle cx="9.2" cy="13.5" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="13.5" r="1.15" fill="currentColor" stroke="none" />
      <path d="M12 8.5V6" />
      <circle cx="12" cy="4.6" r="1.2" />
    </>
  ),
  layout: (
    <>
      <rect x="3.5" y="3.5" width="7" height="9" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="2" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="2" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="2" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M7 9.5l3 3-3 3M12.5 15.5H17" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.8 3.4 2.8 13.6 0 17M12 3.5c-2.8 3.4-2.8 13.6 0 17" />
    </>
  ),
  brush: <path d="M4.5 20c2.6 0 3.5-1 3.5-2.6 0-1.3-.9-2.2-2.2-2.2-1.7 0-2.4 1.6-1.3 4.8zM13.5 4.5l6 6-7.2 7.2-6-6z" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="8.6" cy="10" r="1.5" />
      <path d="M20.5 14.5l-4.5-4.5-8.5 8.5" />
    </>
  ),
  chevronL: <path d="M14.5 6l-6 6 6 6" />,
  chevronR: <path d="M9.5 6l6 6-6 6" />,
  chevronUp: <path d="M6 14.5l6-6 6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  download: <path d="M12 3.5v11M7.5 10l4.5 4.5L16.5 10M4.5 20.5h15" />,
  check: <path d="M4.5 12.5l5 5L20 6.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  refresh: <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1M20.5 3.5v5h-5" />,
  external: (
    <>
      <path d="M13.5 5H19v5.5M19 5l-8.5 8.5M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10" />
    </>
  ),
  zap: <path d="M13 2.5L4.5 13.5H11l-1 8L18.5 10.5H12z" />,
  play: <path d="M8 5.5l11 6.5-11 6.5z" />,
  box: <path d="M20.5 8L12 3.5 3.5 8v8L12 20.5l8.5-4.5zM3.5 8L12 12.5 20.5 8M12 12.5v8" />,
  shield: <path d="M12 3l7 2.8v5.7c0 4.2-3 6.9-7 9.5-4-2.6-7-5.3-7-9.5V5.8z" />,
  alert: (
    <>
      <path d="M12 4.5l8.5 15H3.5z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  code: <path d="M8.5 8l-4 4 4 4M15.5 8l4 4-4 4" />
}

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.5,
  className
}: {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

/** 状态区用的纯描线对勾（带描线动画） */
export function DrawCheck(): JSX.Element {
  return (
    <span className="kd-drawwrap">
      <svg viewBox="0 0 24 24">
        <path d="M4 12.5l5 5L20 6.5" />
      </svg>
    </span>
  )
}
