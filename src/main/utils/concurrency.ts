/**
 * 并发控制原语（v1.0.9 从 netbianService 抽出为公共工具）：
 * - RateGate：串行节流闸门，相邻两次调用启动间隔 ≥ minIntervalMs（站点频控用）
 * - Semaphore：计数信号量，限制最大并发数（原图下载并发用）
 */

/** 串行节流闸门：并发 1，相邻两次启动间隔 ≥ minIntervalMs */
export class RateGate {
  private chain: Promise<void> = Promise.resolve()
  private lastStart = 0

  constructor(private readonly minIntervalMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const slot = this.chain.then(async () => {
      const wait = this.lastStart + this.minIntervalMs - Date.now()
      if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait))
      this.lastStart = Date.now()
    })
    this.chain = slot.catch(() => undefined)
    return slot.then(fn)
  }
}

/** 计数信号量：限制并发数 */
export class Semaphore {
  private active = 0
  private waiters: Array<() => void> = []

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((r) => this.waiters.push(r))
    }
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      const next = this.waiters.shift()
      if (next) next()
    }
  }
}
