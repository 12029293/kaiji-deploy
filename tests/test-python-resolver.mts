/**
 * Python 版本解析器测试（v1.0.9 修复一）：
 * 用 __kdFetcher 打桩验证两条解析链：
 * 1) 首选 endoflife.date/api/python.json（list[0].latest）→ 拼 ftp 直链 → headOk 校验；
 * 2) 回退 python.org/downloads/windows 页面正则 → 全部匹配中取版本号最大者
 *    （回归：旧实现取第一个匹配，可能是 3.13.15 而非最新）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { bundleModule, makeTmpDir, hooks } from './helpers/bundle.mts'

const tmpOut = makeTmpDir('kd-pyres-out-')
const tmpUser = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-pyres-user-'))
process.env.KD_TMP_USERDATA = tmpUser

hooks()

interface Fetcher {
  text?: (url: string, headers: Record<string, string>) => string | Promise<string>
  json?: (url: string, headers: Record<string, string>) => unknown
  head?: (url: string, headers: Record<string, string>) => boolean | Promise<boolean>
}
const g = globalThis as Record<string, unknown>
const fetcher: Fetcher = {}
g.__kdFetcher = fetcher

const mod = await bundleModule(path.join(process.cwd(), 'src/main/config/devEnv.config.ts'), {
  tmpOut,
  name: 'devEnvConfig'
})
const cfg = (await import(mod)) as {
  devEnvResolvers: Record<string, () => Promise<{ url: string; filename: string }>>
}

const HEAD = 'https://www.python.org/ftp/python/'

/** 构造下载页 HTML：按给定版本序拼接 amd64.exe 链接 */
function pageHtml(versions: string[]): string {
  return versions
    .map(
      (v) =>
        `<a href="https://www.python.org/ftp/python/${v}/python-${v}-amd64.exe">Download</a>`
    )
    .join('\n')
}

test('pythonResolver：endoflife 首选链（latest → 拼 URL → HEAD 通过）', async () => {
  fetcher.json = (url) => {
    assert.equal(url, 'https://endoflife.date/api/python.json')
    return [{ cycle: '3.14', latest: '3.14.7', releaseDate: '2026-09-01' }]
  }
  fetcher.head = (url) => {
    assert.equal(url, `${HEAD}3.14.7/python-3.14.7-amd64.exe`)
    return true
  }
  fetcher.text = () => {
    throw new Error('首选链不应请求下载页')
  }
  const r = await cfg.devEnvResolvers.pythonResolver()
  assert.equal(r.url, `${HEAD}3.14.7/python-3.14.7-amd64.exe`)
  assert.equal(r.filename, 'python-3.14.7-amd64.exe')
})

test('pythonResolver：endoflife HEAD 不通过 → 回退页面链取版本最大（3.14.7 > 3.13.15）', async () => {
  fetcher.json = () => [{ cycle: '3.14', latest: '3.14.7' }]
  fetcher.head = () => false
  fetcher.text = (url) => {
    assert.equal(url, 'https://www.python.org/downloads/windows/')
    // 文档序：3.13.15 在前（旧实现的第一个匹配），3.14.7 在后
    return pageHtml(['3.13.15', '3.14.7', '3.12.10'])
  }
  const r = await cfg.devEnvResolvers.pythonResolver()
  assert.match(r.url, /\/3\.14\.7\/python-3\.14\.7-amd64\.exe$/, '必须取版本号最大者而非第一个匹配')
})

test('pythonResolver：endoflife 抛错 → 回退页面链；数值比较 3.10.1 > 3.9.2', async () => {
  fetcher.json = () => {
    throw new Error('endoflife down')
  }
  fetcher.head = () => false
  fetcher.text = () => pageHtml(['3.9.2', '3.10.1'])
  const r = await cfg.devEnvResolvers.pythonResolver()
  assert.match(r.url, /\/3\.10\.1\//, '版本比较必须按数值（3.10 > 3.9）而非字符串序')
})

test('pythonResolver：两条链路全失败 → throw', async () => {
  fetcher.json = () => {
    throw new Error('endoflife down')
  }
  fetcher.head = () => false
  fetcher.text = () => {
    throw new Error('python.org down')
  }
  await assert.rejects(
    () => cfg.devEnvResolvers.pythonResolver(),
    /两条链路均不可用/
  )
})

test('pythonResolver：endoflife 返回空列表 + 页面无匹配 → throw', async () => {
  fetcher.json = () => []
  fetcher.text = () => '<html>no links here</html>'
  await assert.rejects(() => cfg.devEnvResolvers.pythonResolver(), /两条链路均不可用/)
})
