/**
 * Netscape 收藏夹 HTML → Chromium Bookmarks JSON 转换器（ARCH §1.1 挑战 4）。
 *
 * 实现说明（QA Round 1 BUG-1 修复）：node-html-parser 对无 </DT> 闭合的 Netscape HTML
 * 会把 <A> 提升为 <DT> 兄弟节点、内层 <DL> 拍平，导致丢书签/丢分组。
 * 故改为全局扫描式栈状态机：按 token（</DL | <DL | <DT><H3>…</H3> | <DT><A>…</A>）
 * 顺序匹配，H3 入栈 / </DL> 出栈，天然兼容「DT 内嵌套 DL」与「兄弟 DL」两种形态及单行混合 token。
 */
import { randomUUID } from 'node:crypto'

export interface BookmarkNode {
  type: 'folder' | 'url'
  name: string
  url?: string
  dateAdded?: number
  dateModified?: number
  children?: BookmarkNode[]
  isToolbarFolder?: boolean
}

export interface ParseResult {
  root: BookmarkNode
  toolbar: BookmarkNode | null
  folders: number
  links: number
}

/* ---------------- token 扫描解析 ---------------- */

/** HTML 实体解码（书签标题常见 5 种） */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
}

/** 提取属性值（支持双引号/单引号/裸值） */
function attrStr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const m = attrs.match(re)
  if (!m) return undefined
  return m[1] ?? m[2] ?? m[3]
}

function attrNum(attrs: string, name: string): number | undefined {
  const v = attrStr(attrs, name)
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

// token 顺序敏感：</DL 必须在 <DL 之前（避免被 <DL 前缀吞掉）
const TOKEN_RE =
  /<\/DL|<DL|<DT>\s*<H3([^>]*)>([\s\S]*?)<\/H3>|<DT>\s*<A([^>]*)>([\s\S]*?)<\/A>/gi

/**
 * 解析 Netscape 收藏夹 HTML，返回书签树与统计。
 * PERSONAL_TOOLBAR_FOLDER="true" 的 H3 文件夹 → toolbar（收藏夹栏）。
 */
export function parseNetscape(html: string): ParseResult {
  const stats = { folders: 0, links: 0 }
  const root: BookmarkNode = { type: 'folder', name: 'Bookmarks', children: [] }
  const stack: BookmarkNode[] = [root]

  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(html)) !== null) {
    const token = m[0]
    const upper = token.toUpperCase()
    if (upper.startsWith('</DL')) {
      // 文件夹闭合：出栈（root 不出栈，容忍多余 </DL>）
      if (stack.length > 1) stack.pop()
      continue
    }
    if (upper.startsWith('<DL')) {
      // 文件夹由 H3 入栈开启，<DL> 本身不产生节点
      continue
    }
    if (m[1] !== undefined) {
      // <DT><H3 attrs>name</H3> → 新文件夹入栈
      const attrs = m[1]
      stats.folders++
      const folder: BookmarkNode = {
        type: 'folder',
        name: decodeEntities(m[2].trim()) || '新建文件夹',
        dateAdded: attrNum(attrs, 'ADD_DATE'),
        dateModified: attrNum(attrs, 'LAST_MODIFIED'),
        isToolbarFolder: /PERSONAL_TOOLBAR_FOLDER\s*=\s*"?\s*true/i.test(attrs),
        children: []
      }
      const top = stack[stack.length - 1]
      ;(top.children ??= []).push(folder)
      stack.push(folder)
      continue
    }
    if (m[3] !== undefined) {
      // <DT><A attrs>name</A> → 书签链接
      const attrs = m[3]
      const url = attrStr(attrs, 'HREF') ?? ''
      const name = decodeEntities(m[4].trim()) || url
      stats.links++
      const top = stack[stack.length - 1]
      ;(top.children ??= []).push({
        type: 'url',
        name,
        url,
        dateAdded: attrNum(attrs, 'ADD_DATE')
      })
    }
  }

  const toolbar =
    (root.children ?? []).find((n) => n.type === 'folder' && n.isToolbarFolder) ?? null
  return { root, toolbar, folders: stats.folders, links: stats.links }
}

/* ---------------- Chromium Bookmarks JSON 输出 ---------------- */

function chromeTimestamp(unixSec?: number): string {
  const sec = unixSec && unixSec > 0 ? unixSec : Math.floor(Date.now() / 1000)
  return String((sec + 11644473600) * 1_000_000) // Unix → Windows FILETIME(µs)
}

function convert(node: BookmarkNode, nextId: () => string): Record<string, unknown> {
  if (node.type === 'url') {
    return {
      date_added: chromeTimestamp(node.dateAdded),
      date_last_used: '0',
      guid: randomUUID(),
      id: nextId(),
      name: node.name,
      type: 'url',
      url: node.url ?? ''
    }
  }
  return {
    children: (node.children ?? []).map((c) => convert(c, nextId)),
    date_added: chromeTimestamp(node.dateAdded),
    date_modified: chromeTimestamp(node.dateModified),
    guid: randomUUID(),
    id: nextId(),
    name: node.name,
    type: 'folder'
  }
}

/**
 * 生成 Chromium Bookmarks JSON 结构（不含 checksum，Edge 启动会自动重算）。
 * toolbar（收藏夹栏）内容 → roots.bookmark_bar；根级其余项 → roots.other。
 */
export function toChromiumJson(
  parsed: ParseResult
): { roots: Record<string, unknown>; version: number } {
  let counter = 1
  const nextId = (): string => String(counter++)
  const now = chromeTimestamp()
  const folder = (name: string, children: unknown[]): Record<string, unknown> => ({
    children,
    date_added: now,
    date_modified: now,
    guid: randomUUID(),
    id: nextId(),
    name,
    type: 'folder'
  })

  const toolbarChildren = (parsed.toolbar?.children ?? []).map((c) => convert(c, nextId))
  const otherChildren = (parsed.root.children ?? [])
    .filter((n) => n !== parsed.toolbar)
    .map((c) => convert(c, nextId))

  return {
    roots: {
      bookmark_bar: folder('收藏夹栏', toolbarChildren),
      other: folder('其他收藏夹', otherChildren),
      synced: folder('移动设备收藏夹', [])
    },
    version: 1
  }
}
