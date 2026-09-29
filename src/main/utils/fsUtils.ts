/**
 * fs 封装：处理中文路径、文件占用（EBUSY/EPERM）等 Windows 特有问题。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 文件/目录是否存在（任何异常均视为不存在） */
export function existsSafe(p: string): boolean {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

/** 递归创建目录 */
export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true })
}

/** 复制文件（目标目录自动创建） */
export function copySafe(src: string, dest: string): void {
  ensureDir(path.dirname(dest))
  fs.copyFileSync(src, dest)
}

/** 重命名/移动文件（占用时自动重试，最多 5 次 × 300ms） */
export function renameSafe(src: string, dest: string): void {
  ensureDir(path.dirname(dest))
  let lastErr: unknown
  for (let i = 0; i < 5; i++) {
    try {
      fs.renameSync(src, dest)
      return
    } catch (err) {
      lastErr = err
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
        continue
      }
      throw err
    }
  }
  // rename 跨盘失败时降级为复制+删除
  try {
    copySafe(src, dest)
    fs.unlinkSync(src)
  } catch {
    throw lastErr
  }
}

/** 删除文件（不存在时静默成功；占用时忽略） */
export function removeSafe(p: string): void {
  try {
    fs.rmSync(p, { force: true, recursive: true })
  } catch {
    /* 文件被占用等场景忽略，由调用方日志兜底 */
  }
}

/** 读 JSON（文件缺失/损坏返回 null） */
export function readJsonSafe<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T
  } catch {
    return null
  }
}

/**
 * 写 JSON 前备份原文件为 *.kd-bak（ARCH 共享知识 #8：Edge JSON 写入前必须备份）
 */
export function writeJsonWithBackup(p: string, data: unknown): void {
  if (existsSafe(p)) {
    copySafe(p, `${p}.kd-bak`)
  }
  ensureDir(path.dirname(p))
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8')
}

/** 读文本文件（缺失返回 null） */
export function readTextSafe(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf-8')
  } catch {
    return null
  }
}
