/**
 * downloader 解压逻辑测试（v1.0.9 修复一）：
 * 打包真实 downloader.ts（仅 logger/settings 打桩，undici 真实引入但不出网），
 * 用 zlib 真实构造 gzip / deflate / deflate-raw / br 压缩体，
 * 验证 decodeContentEncoding 按 content-encoding 头正确解压。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { bundleModule } from './helpers/bundle.mts'

// downloader 依赖真实 undici（CJS）：外置 external 并把产物放进项目 node_modules 内，
// 使裸引用 'undici' 能从产物位置向上解析到项目依赖（os.tmpdir 下解析不到）。
const outDir = path.join(process.cwd(), 'node_modules', '.kdtest-decode')
fs.mkdirSync(outDir, { recursive: true })
const mod = await bundleModule(path.join(process.cwd(), 'src/main/core/downloader.ts'), {
  tmpOut: outDir,
  name: 'downloader',
  externals: ['undici']
})
const downloader = (await import(mod)) as {
  decodeContentEncoding: (buf: Uint8Array, enc: string | string[] | null | undefined) => Buffer
}

const SAMPLE = Buffer.from(
  'python-3.14.7-amd64.exe https://www.python.org/ftp/python/3.14.7/python-3.14.7-amd64.exe',
  'utf8'
)

test('decodeContentEncoding：无头 / identity / 未知编码 → 原样返回', () => {
  assert.deepEqual(downloader.decodeContentEncoding(SAMPLE, undefined), SAMPLE)
  assert.deepEqual(downloader.decodeContentEncoding(SAMPLE, null), SAMPLE)
  assert.deepEqual(downloader.decodeContentEncoding(SAMPLE, ''), SAMPLE)
  assert.deepEqual(downloader.decodeContentEncoding(SAMPLE, 'identity'), SAMPLE)
  assert.deepEqual(downloader.decodeContentEncoding(SAMPLE, 'unknown-x'), SAMPLE)
})

test('decodeContentEncoding：gzip（本机链路强制 gzip 根因）', () => {
  const gz = zlib.gzipSync(SAMPLE)
  const out = downloader.decodeContentEncoding(gz, 'gzip')
  assert.deepEqual(out, SAMPLE)
})

test('decodeContentEncoding：deflate（zlib 头）', () => {
  const def = zlib.deflateSync(SAMPLE)
  assert.deepEqual(downloader.decodeContentEncoding(def, 'deflate'), SAMPLE)
})

test('decodeContentEncoding：deflate raw（无 zlib 头，回退 inflateRawSync）', () => {
  const raw = zlib.deflateRawSync(SAMPLE)
  assert.deepEqual(downloader.decodeContentEncoding(raw, 'deflate'), SAMPLE)
})

test('decodeContentEncoding：br（brotli）', () => {
  const br = zlib.brotliCompressSync(SAMPLE)
  assert.deepEqual(downloader.decodeContentEncoding(br, 'br'), SAMPLE)
})

test('decodeContentEncoding：链式 "gzip, br" 按序解压', () => {
  const both = zlib.gzipSync(zlib.brotliCompressSync(SAMPLE))
  assert.deepEqual(downloader.decodeContentEncoding(both, 'gzip, br'), SAMPLE)
})

test('decodeContentEncoding：解压失败回退原始数据不抛错', () => {
  const junk = Buffer.from('this is not gzip at all')
  assert.deepEqual(downloader.decodeContentEncoding(junk, 'gzip'), junk)
})
