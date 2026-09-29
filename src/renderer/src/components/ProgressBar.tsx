/**
 * 进度条：青→靛渐变填充 + 平滑过渡。
 */
export default function ProgressBar({
  value,
  className = ''
}: {
  value: number
  className?: string
}): JSX.Element {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07] ${className}`}
    >
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${pct}%`, background: 'linear-gradient(135deg,#8FB6E0 0%,#2E7FC4 55%,#235F93 100%)' }}
      />
    </div>
  )
}
