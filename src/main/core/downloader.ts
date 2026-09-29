/**
 * 下载器：undici 请求 + 可选代理（ProxyAgent）+ 完整浏览器头 + 本地缓存。
 * v1.0.2 增强：
 *  - 多镜像候选 + 逐个重试（VLC 等 CDN 反爬场景）
 *  - 通用协议回退：https 失败自动改 http:// 重试一次（IDM 官方站实测仅 http 可用）
 *  - content-type 校验：响应为 text/* 网页时判为失败，避免把反爬挑战页/错误页存成“安装包”
 * 代理仅作用于 GitHub/外网下载与官网解析。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ProxyAgent, request, type Dispatcher } from 'undici'
import { logger } from './logger'
import { settings } from './settings'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 要求的请求头覆盖（解析器/镜像可携带 Referer 等） */
export type RequestHeaders = Record<string, string>

/** 当前代理 dispatcher（未启用代理时返回 undefined 直连） */
export function currentDispatcher(): Dispatcher | undefined {
  const proxy = settings.proxyUrl()
  return proxy ? new ProxyAgent(proxy) : undefined
}

/** 默认浏览器头 + 调用方覆盖。
 * 注意：不要声明 accept-encoding——undici 的 request 不会自动解压，
 * 声明 gzip/br 会让 fetchText/fetchJson 拿到压缩体导致解析失败。 */
function baseHeaders(extra?: RequestHeaders): RequestHeaders {
  return {
    'user-agent': UA,
    accept: '*/*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...(extra ?? {})
  }
}

/**
 * 按 content-encoding 头解压响应体（v1.0.9 修复，硬前提）：
 * 本机 TUN/代理链路会在未声明 accept-encoding 时也强制 content-encoding: gzip，
 * 直接 res.body.text() 会拿到 gzip 乱码导致所有正则/JSON 解析必然失败。
 * 支持 gzip / deflate（失败回退 inflateRawSync）/ br，可处理 "gzip, br" 链式声明，
 * 无该头（或 identity）时原样返回；解压失败回退原始数据并告警。
 */
export function decodeContentEncoding(
  buf: Uint8Array,
  encoding: string | string[] | null | undefined
): Buffer {
  let cur = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  const raw = Array.isArray(encoding) ? encoding.join(',') : encoding
  const enc = (raw ?? '').toLowerCase()
  if (!enc) return cur
  for (const token of enc.split(',').map((t) => t.trim())) {
    if (!token || token === 'identity') continue
    try {
      if (token === 'gzip') {
        cur = zlib.gunzipSync(cur)
      } else if (token === 'deflate') {
        try {
          cur = zlib.inflateSync(cur)
        } catch {
          // 某些服务端实为 raw deflate（无 zlib 头），回退 inflateRaw
          cur = zlib.inflateRawSync(cur)
        }
      } else if (token === 'br') {
        cur = zlib.brotliDecompressSync(cur)
      } else {
        logger.warn('download', `未知 content-encoding: ${token}，按原始数据处理`)
      }
    } catch (err) {
      logger.warn('download', `${token} 解压失败，按原始数据处理: ${String(err)}`)
      return cur
    }
  }
  return cur
}

/** 把 undici BodyReadable（AsyncIterable<Buffer>）聚合为 Buffer（保留原始字节，不做 utf8 解码） */
async function bodyToBuffer(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike))
  }
  return Buffer.concat(chunks)
}

/** 读取响应头的单值形式（undici 头可能是 string | string[]） */
function headerValue(headers: Dispatcher.ResponseData['headers'], key: string): string | undefined {
  const v = headers[key]
  if (v === undefined) return undefined
  return Array.isArray(v) ? v.join(',') : String(v)
}

/** 通用 GET 文本（官网解析器用）；按 content-encoding 解压后 utf8 解码 */
export async function fetchText(
  url: string,
  timeoutMs = 60_000,
  headers?: RequestHeaders
): Promise<string> {
  const res = await request(url, {
    dispatcher: currentDispatcher(),
    maxRedirections: 5,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    headers: baseHeaders(headers)
  })
  if (res.statusCode >= 400) {
    await res.body.dump().catch(() => undefined)
    throw new Error(`HTTP ${res.statusCode}: ${url}`)
  }
  const raw = await bodyToBuffer(res.body)
  return decodeContentEncoding(raw, headerValue(res.headers, 'content-encoding')).toString('utf8')
}

/** 通用 GET JSON（go.dev/nodejs.org dist index/GitHub API 等） */
export async function fetchJson<T>(
  url: string,
  timeoutMs = 60_000,
  headers?: RequestHeaders
): Promise<T> {
  const text = await fetchText(url, timeoutMs, headers)
  return JSON.parse(text) as T
}

/** 通用 POST JSON（QQ urlsign 等） */
export async function postJson<T>(
  url: string,
  body: unknown,
  headers?: RequestHeaders,
  timeoutMs = 60_000
): Promise<T> {
  const res = await request(url, {
    method: 'POST',
    dispatcher: currentDispatcher(),
    maxRedirections: 5,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    headers: { ...baseHeaders(headers), 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (res.statusCode >= 400) {
    await res.body.dump().catch(() => undefined)
    throw new Error(`HTTP ${res.statusCode}: ${url}`)
  }
  const raw = await bodyToBuffer(res.body)
  const text = decodeContentEncoding(raw, headerValue(res.headers, 'content-encoding')).toString(
    'utf8'
  )
  return JSON.parse(text) as T
}

/**
 * HEAD 探测（v1.0.9，python 解析链安装包存在性校验等）：
 * 2xx 返回 true；请求失败（网络异常）返回 false 而非抛错，便于回退链继续。
 */
export async function headOk(
  url: string,
  timeoutMs = 60_000,
  headers?: RequestHeaders
): Promise<boolean> {
  try {
    const res = await request(url, {
      method: 'HEAD',
      dispatcher: currentDispatcher(),
      maxRedirections: 5,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      headers: baseHeaders(headers)
    })
    await res.body.dump().catch(() => undefined)
    return res.statusCode >= 200 && res.statusCode < 300
  } catch (err) {
    logger.warn('download', `HEAD 探测失败: ${url} → ${String(err)}`)
    return false
  }
}

/**
 * 解析重定向的最终 URL（不跟随，读取 Location 头）。
 * 非 3xx 响应时返回原始 url（调用方据此决定是否走其它分支）。
 */
export async function resolveLocation(
  url: string,
  headers?: RequestHeaders,
  timeoutMs = 60_000
): Promise<string> {
  const res = await request(url, {
    dispatcher: currentDispatcher(),
    maxRedirections: 0,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    headers: baseHeaders(headers)
  })
  const loc = res.headers['location']
  if (res.statusCode >= 300 && res.statusCode < 400 && typeof loc === 'string' && loc.length > 0) {
    try {
      await res.body.dump()
    } catch {
      /* 丢弃响应体失败可忽略 */
    }
    return new URL(loc, url).href
  }
  try {
    await res.body.dump()
  } catch {
    /* 同上 */
  }
  return url
}

/* ---------------- v1.1.0：dispatcher 选择（Python 下载事故修复） ---------------- */

/**
 * 直连优先域名白名单：国内直连可达的大文件官方源（url-resolver 解析结果基本落在这里）。
 * 本机代理对部分大文件流式响应会中途掐断（实测 python.org 33MB 稳定复现
 * SocketError: other side closed，v1.1.0 Python「全部下载候选失败」事故根因），
 * 这些域名代理开启时也先直连，失败再落代理。
 */
const DIRECT_FIRST_HOSTS = new Set([
  'www.python.org',
  'python.org',
  'dl.google.com',
  'nodejs.org'
])

/** 单次下载尝试的 dispatcher 模式 */
export type DispatchMode = 'proxy' | 'direct'

/** 一次下载尝试：目标 URL + dispatcher 模式 */
export interface DownloadAttempt {
  url: string
  mode: DispatchMode
}

/** 判断 URL 是否命中直连优先域名（解析失败按非白名单处理） */
export function isDirectFirstHost(url: string): boolean {
  try {
    return DIRECT_FIRST_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * 生成下载尝试序列（候选 URL × dispatcher 模式，按优先级排序）：
 * - 代理未开启：每个变体仅直连。
 * - 代理开启 + 直连优先域名：直连 → 代理（python.org 等源直连即可，代理反而掐流）。
 * - 代理开启 + 其它域名：代理 → 直连（GitHub 等被墙源代理命中即返回；代理异常时直连兜底）。
 * 每个 URL 变体仍保留 https → http 协议回退（IDM 官方站仅 http 可用的历史修复）。
 */
export function buildAttempts(
  url: string,
  mirrors: string[] | undefined,
  proxyUrl: string | null
): DownloadAttempt[] {
  const attempts: DownloadAttempt[] = []
  for (const cand of [url, ...(mirrors ?? [])]) {
    for (const variant of protocolVariants(cand)) {
      if (!proxyUrl) {
        attempts.push({ url: variant, mode: 'direct' })
      } else if (isDirectFirstHost(variant)) {
        attempts.push({ url: variant, mode: 'direct' }, { url: variant, mode: 'proxy' })
      } else {
        attempts.push({ url: variant, mode: 'proxy' }, { url: variant, mode: 'direct' })
      }
    }
  }
  return attempts
}

/** 缓存键：sha1(url)（P2-2：按 URL 哈希跳过重复下载） */
function cacheKey(url: string): string {
  return crypto.createHash('sha1').update(url).digest('hex')
}

/** 某个 URL 在缓存目录中的落盘路径 */
export function cachedPath(cacheDir: string, url: string, filename: string): string {
  return path.join(cacheDir, `${cacheKey(url)}-${filename}`)
}

export interface DownloadProgress {
  percent: number
  received: number
  total: number
}

export interface DownloadOptions {
  proxy?: string | null
  onProgress?: (p: DownloadProgress) => void
  timeoutMs?: number
  /** 备用镜像（主 URL 失败后依次尝试；单一逻辑文件视为同一目标） */
  mirrors?: string[]
  /** 附加请求头（Referer / Range 等） */
  headers?: RequestHeaders
  /** 内部字段：单次尝试的 dispatcher 模式（由 downloadToFile 的尝试序列注入） */
  dispatchMode?: DispatchMode
}

/** 单次落盘：请求 → 校验 → 流式写盘 */
async function fetchToFile(url: string, dest: string, opts: DownloadOptions): Promise<number> {
  // v1.1.0：dispatcher 由尝试序列的 dispatchMode 决定；mode=direct 时强制直连
  const dispatcher =
    opts.dispatchMode === 'direct' ? undefined : opts.proxy ? new ProxyAgent(opts.proxy) : undefined
  logger.info('download', `GET ${url} -> ${dest}`)
  const res = await request(url, {
    dispatcher,
    maxRedirections: 5,
    headersTimeout: opts.timeoutMs ?? 120_000,
    bodyTimeout: opts.timeoutMs ?? 600_000,
    headers: baseHeaders(opts.headers)
  })
  if (res.statusCode >= 400 || !res.body) {
    throw new Error(`HTTP ${res.statusCode}: ${url}`)
  }
  const ctype = String(res.headers['content-type'] ?? '')
  if (/^text\//i.test(ctype)) {
    // 反爬挑战页 / 错误页：不是安装包本体
    const peek = await res.body.text()
    throw new Error(
      `响应为网页而非安装包（content-type=${ctype}，长度 ${peek.length}）: ${url}`
    )
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const total = Number(res.headers['content-length'] ?? 0)
  let received = 0
  let lastPct = -1
  // 注意：undici 的 request() 返回的 body 已是 Node 可读流（BodyReadable），
  // 直接 pipe 即可；用 Readable.fromWeb 会报 “argument must be an instance of ReadableStream”。
  const src = res.body as unknown as Readable
  src.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (opts.onProgress && total > 0) {
      const pct = Math.min(100, Math.floor((received / total) * 100))
      if (pct !== lastPct) {
        lastPct = pct
        opts.onProgress({ percent: pct, received, total })
      }
    }
  })
  await pipeline(src, fs.createWriteStream(dest))
  opts.onProgress?.({ percent: 100, received, total: total || received })
  logger.info('download', `下载完成 ${dest}（${(received / 1024 / 1024).toFixed(1)} MB）`)
  return received
}

/** 协议回退候选：https 失败时追加 http:// 变体 */
function protocolVariants(url: string): string[] {
  if (url.startsWith('https://')) {
    return [url, `http://${url.slice('https://'.length)}`]
  }
  return [url]
}

/**
 * 下载文件到指定路径（流式写盘 + 进度回调）。
 * v1.1.0 重写候选循环：尝试序列由 buildAttempts 生成（候选 URL 的协议回退 ×
 * dispatcher 模式），代理开启时 python.org 等直连源先直连、被墙源代理优先直连兜底。
 * 全部尝试失败抛出聚合错误。
 */
export async function downloadToFile(
  url: string,
  dest: string,
  opts: DownloadOptions = {}
): Promise<string> {
  const attempts = buildAttempts(url, opts.mirrors, opts.proxy ?? null)
  const errors: string[] = []
  for (const att of attempts) {
    try {
      await fetchToFile(att.url, dest, { ...opts, dispatchMode: att.mode })
      // 明确记录最终命中的下载源与 dispatcher 模式，便于后续排查
      logger.info(
        'download',
        `下载成功，命中源: ${att.url}（${att.mode === 'proxy' ? '代理' : '直连'}）`
      )
      return dest
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${att.url}（${att.mode}） → ${msg}`)
      logger.warn('download', `下载候选失败，尝试下一个: ${msg}`)
    }
  }
  throw new Error(`全部下载候选失败：\n${errors.join('\n')}`)
}
