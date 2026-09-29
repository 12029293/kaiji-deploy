/**
 * 开发环境五件套（Go/Git/Python/Node.js/FFmpeg）：静默安装/解压 + 版本校验。
 */
import { useState } from 'react'
import { IPC } from '@shared/types'
import { call } from '../api'
import { useTasksStore } from '../store/tasksStore'
import { useUiStore } from '../store/uiStore'
import AppCard from '../components/AppCard'
import { Icon } from '../components/Icons'

export default function DevEnvPage(): JSX.Element {
  const byCategory = useTasksStore((s) => s.byCategory)
  const toast = useUiStore((s) => s.toast)
  const [verifying, setVerifying] = useState(false)
  const list = byCategory('devenv')

  const verifyAll = async (): Promise<void> => {
    setVerifying(true)
    try {
      await call(IPC.DEVENV_VERIFY_ALL)
      toast('校验完成，结果见各卡片状态', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="kd-fade-in mx-auto max-w-[1400px]">
      <div className="mb-[14px] flex items-baseline gap-[10px]">
        <h3 className="text-[14px] font-semibold text-white">开发环境</h3>
        <p className="text-xs text-dim">
          {list.length} 项 · SDK 与运行时，装完自动追加系统 PATH
        </p>
        <span className="flex-1" />
        <button
          type="button"
          className="kd-mini-btn"
          onClick={() => void verifyAll()}
          disabled={verifying}
        >
          <Icon name={verifying ? 'refresh' : 'check'} size={13} />
          {verifying ? '校验中…' : '校验已装版本'}
        </button>
      </div>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
      >
        {list.map((cfg, i) => (
          <AppCard key={cfg.id} cfg={cfg} index={i} />
        ))}
      </div>
    </div>
  )
}
