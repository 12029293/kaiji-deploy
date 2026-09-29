/**
 * 渲染进程 invoke 封装：拆包 ApiResponse，失败抛错供上层 Toast。
 */
import type { ApiResponse } from '@shared/types'

export async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const res = (await window.kdAPI.invoke(channel, payload)) as ApiResponse<T>
  if (!res.ok) {
    throw new Error(res.error ?? '操作失败')
  }
  return res.data as T
}
