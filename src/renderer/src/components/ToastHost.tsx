/**
 * Toast 通知（对齐原型 #toasts）：右上角滑入，3.2s 后自动退场。
 */
import { useUiStore, type ToastKind } from '../store/uiStore'

const KIND_CLASS: Record<ToastKind, string> = {
  info: 't-info',
  success: 't-success',
  error: 't-failed',
  warn: 't-warn'
}

export default function ToastHost(): JSX.Element {
  const toasts = useUiStore((s) => s.toasts)
  const dismiss = useUiStore((s) => s.dismissToast)

  return (
    <div className="kd-toasts">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          title="点击关闭"
          className={`kd-toast ${KIND_CLASS[t.kind]} ${t.closing ? 'closing' : ''}`}
        >
          <i />
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{t.text}</span>
        </button>
      ))}
    </div>
  )
}
