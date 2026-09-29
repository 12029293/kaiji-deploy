/**
 * 危险操作二次确认弹窗（禁用更新 / 删输入法 / 系统激活 / 关闭 Edge / 开始部署等）。
 */
import { useUiStore } from '../store/uiStore'
import { Icon } from './Icons'

export default function ConfirmDialog(): JSX.Element | null {
  const open = useUiStore((s) => s.confirmOpen)
  const options = useUiStore((s) => s.confirmOptions)
  const close = useUiStore((s) => s.closeConfirm)

  if (!open || !options) return null

  const onConfirm = async (): Promise<void> => {
    close()
    await options.onConfirm()
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="kd-glass-strong kd-fade-in w-[460px] rounded-2xl p-6 shadow-dock">
        <div className="flex items-start gap-3">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
            style={{
              background: options.danger ? 'rgba(248,113,113,.12)' : 'rgba(34,211,238,.12)',
              color: options.danger ? 'var(--kd-err)' : 'var(--kd-cyan)',
              border: '1px solid var(--kd-line-strong)'
            }}
          >
            <Icon name={options.danger ? 'alert' : 'check'} size={18} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-white">{options.title}</h3>
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-[22px] text-sub">
              {options.message}
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="kd-btn-ghost" onClick={close}>
            取消
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            className={options.danger ? 'kd-btn' : 'kd-btn-primary'}
            style={
              options.danger
                ? { background: 'linear-gradient(135deg,#F87171,#DC2626)', boxShadow: '0 6px 20px rgba(248,113,113,.3)' }
                : undefined
            }
          >
            {options.confirmText ?? '确认'}
          </button>
        </div>
      </div>
    </div>
  )
}
