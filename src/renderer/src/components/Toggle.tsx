/**
 * 拨动开关：纯 CSS 滑块（对齐原型 .switch），支持键盘 Space/Enter。
 */
import type { ReactNode } from 'react'

export default function Toggle({
  on,
  onChange,
  label,
  title,
  disabled
}: {
  on: boolean
  onChange: (value: boolean) => void
  label?: ReactNode
  title?: string
  disabled?: boolean
}): JSX.Element {
  const btn = (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={typeof label === 'string' ? label : title}
      title={title}
      disabled={disabled}
      className={`kd-switch ${on ? 'on' : ''}`}
      style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
      onClick={(e) => {
        // 阻止冒泡到带 label 的外层容器，避免一次点击触发两次 onChange
        e.stopPropagation()
        onChange(!on)
      }}
    />
  )

  if (label === undefined) return btn

  return (
    <div
      className="kd-switch-row"
      style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
      onClick={() => {
        if (!disabled) onChange(!on)
      }}
    >
      <span className="select-none">{label}</span>
      <span>{btn}</span>
    </div>
  )
}
