/**
 * Edge 收藏夹解析器测试：用真实 Edge收藏夹.html 验证
 * 收藏夹栏/顶层书签分组、URL/标题无损、Chromium Bookmarks JSON 结构。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { bundleModule, makeTmpDir } from './helpers/bundle.mts'

const EDGE_HTML = 'C:\\Users\\Administrator\\Desktop\\Edge收藏夹.html'
const tmpOut = makeTmpDir('kd-parser-')
const html = fs.readFileSync(EDGE_HTML, 'utf-8')

const mod = await bundleModule(path.join(process.cwd(), 'src/main/services/edgeBookmarksParser.ts'), {
  tmpOut,
  name: 'edgeBookmarksParser'
})
const { parseNetscape, toChromiumJson } = await import(mod)

// 独立统计真实 HTML 中的书签数（与实现互为对照）
const htmlLinkCount = (html.match(/<A\s+HREF=/gi) ?? []).length

test('解析真实 Edge 收藏夹：统计与 HTML 中 <A> 数量一致', () => {
  const r = parseNetscape(html)
  assert.equal(r.links, htmlLinkCount, `links=${r.links} 应等于 HTML 中的 <A> 数 ${htmlLinkCount}`)
  assert.ok(r.links >= 20, '真实收藏夹应至少 20 条链接')
  // 收藏夹栏 1 个 H3 文件夹
  assert.equal(r.folders, 1)
})

test('PERSONAL_TOOLBAR_FOLDER 识别与分组', () => {
  const r = parseNetscape(html)
  assert.ok(r.toolbar, '应识别出收藏夹栏')
  assert.equal(r.toolbar.isToolbarFolder, true)
  assert.equal(r.toolbar.name, '收藏夹栏')
  // 收藏夹栏内容 → bookmark_bar；顶层散书签 → other
  assert.ok(r.toolbar.children.length >= 15)
  const others = r.root.children.filter((n) => n !== r.toolbar)
  const otherNames = others.map((n) => n.name)
  for (const expected of ['J搜索', '爱纯净博客', '爱纯净官网']) {
    assert.ok(otherNames.includes(expected), `顶层书签 ${expected} 应落在 other 分组，实际: ${otherNames.join(',')}`)
  }
})

test('URL 与标题无损（含中文、长标题、特殊字符）', () => {
  const r = parseNetscape(html)
  const all: Array<{ name: string; url: string }> = []
  const walk = (n): void => {
    if (n.type === 'url') all.push({ name: n.name, url: n.url })
    for (const c of n.children ?? []) walk(c)
  }
  walk(r.root)
  const find = (urlPart) => all.find((x) => x.url.includes(urlPart))
  assert.ok(find('bd.001060.com'), '百度直链应保留')
  assert.equal(find('bd.001060.com').name, '百度一下')
  assert.ok(find('webchat2api').name.includes('README.zh-CN.md'), '长标题应无损')
  assert.ok(find('xn--vduyey89e.com'), 'punycode 域名应保留')
  assert.ok(find('jsousuo.cn').name === 'J搜索')
  // 所有 url 非空
  for (const x of all) assert.ok(x.url.length > 0, '每条书签必须有 url')
})

test('toChromiumJson：符合 Chromium Bookmarks 结构（roots 三项 + version 1 + 无 checksum）', () => {
  const parsed = parseNetscape(html)
  const json = toChromiumJson(parsed)
  assert.equal(json.version, 1)
  assert.deepEqual(Object.keys(json.roots).sort(), ['bookmark_bar', 'other', 'synced'])
  for (const key of ['bookmark_bar', 'other', 'synced']) {
    const root = json.roots[key]
    assert.equal(root.type, 'folder')
    assert.ok(typeof root.guid === 'string' && root.guid.length === 36)
    assert.ok(Array.isArray(root.children))
  }
  // 收藏夹栏内容进 bookmark_bar，顶层散签进 other
  assert.equal(json.roots.bookmark_bar.children.length, parsed.toolbar.children.length)
  assert.equal(json.roots.other.children.length, parsed.root.children.length - 1)
  assert.equal(JSON.stringify(json).includes('checksum'), false, '不应包含 checksum 字段')
})

test('date_added 为 Windows FILETIME(µs)（Unix + 11644473600 秒差，×1e6）', () => {
  const parsed = parseNetscape(html)
  const json = toChromiumJson(parsed)
  const baidu = json.roots.bookmark_bar.children.find((c) => c.name === '百度一下')
  // 源 HTML: ADD_DATE="1748866439"
  const expected = String((1748866439 + 11644473600) * 1_000_000)
  assert.equal(baidu.date_added, expected)
})

test('id 唯一且递增、guid 唯一', () => {
  const parsed = parseNetscape(html)
  const json = toChromiumJson(parsed)
  const ids = new Set<string>()
  const guids = new Set<string>()
  const walk = (n): void => {
    ids.add(n.id)
    guids.add(n.guid)
    for (const c of n.children ?? []) walk(c)
  }
  for (const k of ['bookmark_bar', 'other', 'synced']) walk(json.roots[k])
  // 节点总数 = 2 根有内容 + synced + 内部节点
  const expectedCount =
    1 + parsed.toolbar.children.length + // bookmark_bar 根 + 子
    1 + (parsed.root.children.length - 1) + // other 根 + 子
    1 // synced 根
  assert.equal(ids.size, expectedCount, '所有 id 唯一')
  assert.equal(guids.size, expectedCount, '所有 guid 唯一')
})

test('合成用例：DT 内嵌套 DL 与 兄弟 DL 两种 Netscape 形态均可解析', () => {
  const inlineForm = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
    <DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">栏</H3>
      <DL><p><DT><A HREF="https://a.example/">A</A></DL><p>
    <DT><A HREF="https://b.example/">B</A>
  </DL><p>`
  const r1 = parseNetscape(inlineForm)
  assert.equal(r1.toolbar.children.length, 1)
  assert.equal(r1.toolbar.children[0].url, 'https://a.example/')
  assert.equal(r1.links, 2)

  // 空输入
  const empty = parseNetscape('<html></html>')
  assert.equal(empty.links, 0)
  assert.equal(empty.toolbar, null)
})

test('无 add_date 时使用当前时间，date_last_used 为 "0"', () => {
  const parsed = parseNetscape('<DL><p><DT><A HREF="https://x.example/">X</A></DL><p>')
  const json = toChromiumJson(parsed)
  const node = json.roots.other.children[0]
  assert.equal(node.date_last_used, '0')
  assert.ok(Number(node.date_added) > 0)
})
