/**
 * 状态徽章（pill 形态）：八态 + 过程态跑马灯圆点，颜色语义与原型一致。
 */
import type { TaskStatus } from '@shared/types'

const PILL: Record<TaskStatus, { label: string; cls: string }> = {
  pending: { label: '待安装', cls: '' },
  checking: { label: '解析中', cls: 'c-run' },
  downloading: { label: '下载中', cls: 'c-run' },
  installing: { label: '安装中', cls: 'c-run' },
  verifying: { label: '校验中', cls: 'c-run' },
  success: { label: '成功', cls: 'c-ok' },
  failed: { label: '失败', cls: 'c-err' },
  'manual-needed': { label: '需手动', cls: 'c-warn' }
}

export default function StatusPill({ status }: { status: TaskStatus }): JSX.Element {
  const p = PILL[status]
  return (
    <span className={`kd-pill ${p.cls}`}>
      <i />
      {p.label}
    </span>
  )
}
