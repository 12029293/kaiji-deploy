/**
 * Wallhaven 壁纸服务测试（v1.1.0 改动）：
 * - 字段提取（data[].path/thumbs.large/resolution/id）/ ≥1080p 过滤 / 越界页 data:[] 判空
 * - v1.1.0 修复三：parseMeta 解析 meta.current_page/last_page + 缺失兜底
 * - listPhotos 返回 WallhavenPage（photos + page + lastPage），page 参数透传 API（打桩验证）
 * - v1.1.0 改动二：移除 no-proxy 硬阻断 —— 未开代理也直连发请求，网络失败展示真实错误
 * 单元测试不发真实网络请求 —— globalThis.fetch 打桩，dispatcher 经 __kdProxyOverride 控制。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { bundleModule, makeTmpDir, hooks } from './helpers/bundle.mts'

const tmpOut = makeTmpDir('kd-wh-out-')
const tmpUser = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-wh-user-'))
process.env.KD_TMP_USERDATA = tmpUser

// ---------- fetch 打桩（不发出任何真实请求） ----------
interface FetchCall {
  url: string
  init?: RequestInit
}
const fetchCalls: FetchCall[] = []
let responder: (url: string) => Response = () => new Response('{}')
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  fetchCalls.push({ url, init })
  return responder(url)
}) as typeof fetch

hooks()

const g = globalThis as Record<string, unknown>
/** dispatcher 开关：'http://127.0.0.1:7897' = 代理加速开；undefined = 关（直连） */
function setProxy(v: string | undefined): void {
  if (v === undefined) delete g.__kdProxyOverride
  else g.__kdProxyOverride = v
}

const mod = await bundleModule(path.join(process.cwd(), 'src/main/services/wallhavenService.ts'), {
  tmpOut,
  name: 'wallhavenService'
})
const wh = (await import(mod)) as {
  searchUrl: (page: number) => string
  parseSearchResponse: (json: unknown) => Array<{
    id: string
    resW: number
    resH: number
    thumbUrl: string
    origUrl: string
  }>
  parseMeta: (json: unknown, requestPage: number) => { page: number; lastPage: number }
  WallhavenService: new (
    apiIntervalMs?: number,
    maxDownloadConcurrency?: number
  ) => {
    listPhotos: (page: number) => Promise<{
      photos: unknown[]
      page: number
      lastPage: number
    }>
    thumb: (id: string, url?: string) => Promise<string>
    downloadAndSet: (id: string, origUrl: string) => Promise<{
      ok: boolean
      reason?: string
      message: string
      path?: string
    }>
  }
}

// ---------- 侦察报告（C:\kdtest\recon-v109\REPORT.md）真实响应片段 ----------
const API_ITEM_OK = {
  id: 'zpvdzv',
  url: 'https://wallhaven.cc/w/zpvdzv',
  purity: 'sfw',
  category: 'general',
  resolution: '5599x3149',
  path: 'https://w.wallhaven.cc/full/zp/wallhaven-zpvdzv.jpg',
  thumbs: { large: 'https://th.wallhaven.cc/lg/zp/zpvdzv.jpg' }
}

function item(id: string, res: string): Record<string, unknown> {
  return {
    id,
    purity: 'sfw',
    category: 'general',
    resolution: res,
    path: `https://w.wallhaven.cc/full/${id.slice(0, 2)}/wallhaven-${id}.jpg`,
    thumbs: { large: `https://th.wallhaven.cc/lg/${id.slice(0, 2)}/${id}.jpg` }
  }
}

// ---------- 极小 JPEG 缓冲（满足 SOF 解析即可） ----------
function jpegBuf(w: number, h: number): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff,
    0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ])
}

test('searchUrl：模板参数（atleast/sorting/categories/purity/page）', () => {
  assert.equal(
    wh.searchUrl(1),
    'https://wallhaven.cc/api/v1/search?atleast=1920x1080&sorting=hot&categories=100&purity=100&page=1'
  )
  assert.equal(wh.searchUrl(3).endsWith('page=3'), true)
  assert.equal(wh.searchUrl(0).endsWith('page=1'), true, '非法页码钳制为 1')
})

test('parseSearchResponse：字段提取（path→origUrl / thumbs.large→thumbUrl / resolution）', () => {
  const out = wh.parseSearchResponse({ data: [API_ITEM_OK], meta: { current_page: 1, last_page: 15 } })
  assert.equal(out.length, 1)
  const p = out[0]
  assert.equal(p.id, 'zpvdzv')
  assert.equal(p.origUrl, 'https://w.wallhaven.cc/full/zp/wallhaven-zpvdzv.jpg')
  assert.equal(p.thumbUrl, 'https://th.wallhaven.cc/lg/zp/zpvdzv.jpg')
  assert.equal(p.resW, 5599)
  assert.equal(p.resH, 3149)
})

test('parseSearchResponse：<1080p 条目被客户端过滤', () => {
  const out = wh.parseSearchResponse({
    data: [item('aaaaaa', '1920x1080'), item('bbbbbb', '1366x768'), item('cccccc', '1919x1080')]
  })
  assert.deepEqual(out.map((p) => p.id), ['aaaaaa'], '只保留 ≥1920x1080（含边界与宽高各自达标判断）')
})

test('parseSearchResponse：越界页 data:[] → 空数组（判空翻页依据）', () => {
  const out = wh.parseSearchResponse({ data: [], meta: { current_page: 16, last_page: 15 } })
  assert.deepEqual(out, [])
})

test('parseSearchResponse：缺 id/path/resolution 的条目跳过；data 缺失返回空', () => {
  assert.deepEqual(
    wh.parseSearchResponse({ data: [{ id: 'x' }, { path: 'https://w/' }, { id: 'y', path: 'https://w/' }] }),
    []
  )
  assert.deepEqual(wh.parseSearchResponse(null), [])
  assert.deepEqual(wh.parseSearchResponse({}), [])
})

// ---------- v1.1.0 修复三：parseMeta 分页解析 ----------

test('parseMeta：meta.current_page / last_page 正常解析', () => {
  assert.deepEqual(wh.parseMeta({ meta: { current_page: 3, last_page: 42 } }, 3), {
    page: 3,
    lastPage: 42
  })
  assert.deepEqual(wh.parseMeta({ meta: { current_page: 1, last_page: 15 } }, 1), {
    page: 1,
    lastPage: 15
  })
})

test('parseMeta：meta 缺失 → 回退请求页码；有数据时允许继续翻页', () => {
  assert.deepEqual(wh.parseMeta({ data: [API_ITEM_OK] }, 2), { page: 2, lastPage: 3 })
  assert.deepEqual(wh.parseMeta({ data: [] }, 7), { page: 7, lastPage: 7 })
  assert.deepEqual(wh.parseMeta(null, 4), { page: 4, lastPage: 4 })
})

test('parseMeta：非法 meta 值 → 回退请求页码', () => {
  assert.deepEqual(wh.parseMeta({ meta: { current_page: -5, last_page: 0 } }, 6), {
    page: 6,
    lastPage: 6
  })
  assert.deepEqual(wh.parseMeta({ meta: { current_page: 'x', last_page: 'y' } }, 2), {
    page: 2,
    lastPage: 2
  })
})

// ---------- v1.1.0 改动二：listPhotos 不再有 no-proxy 硬阻断 ----------

test('listPhotos：代理关闭 → 直连发请求且 page 参数透传，返回 WallhavenPage', async () => {
  setProxy(undefined)
  const svc = new wh.WallhavenService(0, 1)
  responder = () =>
    new Response(JSON.stringify({ data: [API_ITEM_OK], meta: { current_page: 2, last_page: 33 } }))
  fetchCalls.length = 0
  const res = await svc.listPhotos(2)
  assert.equal(fetchCalls.length, 1, '未开代理也应发请求（直连）')
  assert.match(fetchCalls[0].url, /page=2/, 'page 参数必须透传到 API URL')
  assert.equal(res.page, 2)
  assert.equal(res.lastPage, 33)
  assert.equal((res.photos as Array<{ id: string }>).length, 1)
  assert.equal((res.photos as Array<{ id: string }>)[0].id, 'zpvdzv')
})

test('listPhotos：代理开启 → 走代理 dispatcher 请求并解析', async () => {
  setProxy('http://127.0.0.1:7897')
  const svc = new wh.WallhavenService(0, 1)
  responder = (url) => {
    assert.match(url, /atleast=1920x1080&sorting=hot&categories=100&purity=100&page=3/)
    return new Response(JSON.stringify({ data: [API_ITEM_OK], meta: { current_page: 3, last_page: 15 } }))
  }
  fetchCalls.length = 0
  const res = await svc.listPhotos(3)
  assert.equal(res.photos.length, 1)
  assert.equal(res.page, 3)
  assert.equal(res.lastPage, 15)
  const init = fetchCalls[0].init as { dispatcher?: unknown }
  assert.ok(init.dispatcher, '代理开启时请求应携带 dispatcher')
})

test('listPhotos：越界页 data:[] → 空 photos 不报错，页码取服务端 meta', async () => {
  setProxy(undefined)
  const svc = new wh.WallhavenService(0, 1)
  responder = () =>
    new Response(JSON.stringify({ data: [], meta: { current_page: 34, last_page: 33 } }))
  const res = await svc.listPhotos(34)
  assert.deepEqual(res.photos, [])
  assert.equal(res.page, 34)
  assert.equal(res.lastPage, 33, '末页时下一页按钮应置灰')
})

test('listPhotos：直连网络失败 → 抛真实错误（不再引导开代理）', async () => {
  setProxy(undefined)
  const svc = new wh.WallhavenService(0, 1)
  responder = () => {
    throw new Error('getaddrinfo ENOTFOUND wallhaven.cc')
  }
  await assert.rejects(() => svc.listPhotos(1), /ENOTFOUND/)
})

// ---------- 下载链路 ----------

test('downloadAndSet：代理关闭直连 → 像素校验通过落盘并调 setWallpaper', async () => {
  setProxy(undefined)
  const svc = new wh.WallhavenService(0, 1)
  const hook = hooks()
  hook.reset()
  const origUrl = 'https://w.wallhaven.cc/full/zp/wallhaven-zpvdzv.jpg'
  responder = (url) => {
    assert.equal(url, origUrl)
    return new Response(jpegBuf(3840, 2160), { headers: { 'content-type': 'image/jpeg' } })
  }
  fetchCalls.length = 0
  const r = await svc.downloadAndSet('zpvdzv', origUrl)
  assert.equal(r.ok, true, `应成功: ${r.message}`)
  assert.equal(fetchCalls.length, 1, '未开代理也应直连下载')
  assert.match(r.path ?? '', /zpvdzv_3840x2160\.jpg$/, '落盘名 {id}_{W}x{H}.jpg')
  assert.match(r.path ?? '', /wallpapers[\\/]wallhaven/, '落盘目录 userData/wallpapers/wallhaven')
  assert.ok(fs.existsSync(r.path ?? ''), '原图必须已落盘')
  assert.equal(hook.wallpaperSets.length, 1, '应复用 wallpaperService.setWallpaper')
  assert.equal(hook.wallpaperSets[0], r.path)
})

test('downloadAndSet：原图 <1080p → too-small 且不落盘不设壁纸', async () => {
  setProxy(undefined)
  const svc = new wh.WallhavenService(0, 1)
  const hook = hooks()
  hook.reset()
  responder = () => new Response(jpegBuf(1366, 768))
  const r = await svc.downloadAndSet('small1', 'https://w.wallhaven.cc/full/sm/wallhaven-small1.jpg')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'too-small')
  assert.equal(hook.wallpaperSets.length, 0, '低分辨率不得设壁纸')
})

test('downloadAndSet：响应非图片 → parse-failed', async () => {
  setProxy(undefined)
  const svc = new wh.WallhavenService(0, 1)
  responder = () => new Response('<html>error page</html>')
  const r = await svc.downloadAndSet('badpg', 'https://w.wallhaven.cc/full/ba/wallhaven-badpg.jpg')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'parse-failed')
})

test('downloadAndSet：网络失败 → reason=network 且 message 携带真实错误', async () => {
  setProxy(undefined)
  const svc = new wh.WallhavenService(0, 1)
  responder = () => {
    throw new Error('connect ETIMEDOUT 1.2.3.4:443')
  }
  const r = await svc.downloadAndSet('netfail', 'https://w.wallhaven.cc/full/ne/wallhaven-netfail.jpg')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'network')
  assert.match(r.message, /ETIMEDOUT/, '应展示真实网络错误而非「请开代理」')
  assert.doesNotMatch(r.message, /代理加速/)
})

test('downloadAndSet：缺 origUrl → network 缺少原图直链', async () => {
  setProxy(undefined)
  const svc = new wh.WallhavenService(0, 1)
  fetchCalls.length = 0
  const r = await svc.downloadAndSet('nourl', '')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'network')
  assert.equal(fetchCalls.length, 0)
})

test('thumb：无 url 且无缓存 → 空串不触网', async () => {
  setProxy(undefined)
  const svc = new wh.WallhavenService(0, 1)
  fetchCalls.length = 0
  const dataUrl = await svc.thumb('nocache1')
  assert.equal(dataUrl, '')
  assert.equal(fetchCalls.length, 0)
})

// 还原全局状态（防串扰）
test('afterAll：还原 fetch 与代理开关', () => {
  globalThis.fetch = realFetch
  setProxy(undefined)
})
