/**
 * v1.0.2 关键实现静态核对（无需联网 / 无需 Electron）：
 *  - settings 默认值（createShortcut=true / setAutostart=false）
 *  - logger.initLogDir 存在且 index.ts 顶部调用
 *  - downloader 具备协议回退 + 多镜像 + text/* 拒绝
 *  - installer zip 防御（非 exe/msi 不执行）
 *  - shared/types 新增 ShortcutSpec / OPTIONS_GET / OPTIONS_SET / manualHint
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { SRC } from './helpers/bundle.mts'

const read = (p: string): string => fs.readFileSync(path.join(SRC, p), 'utf-8')

test('settings 默认值：createShortcut=true、setAutostart=false', () => {
  const src = read('main/core/settings.ts')
  assert.match(src, /createShortcut:\s*true/)
  assert.match(src, /setAutostart:\s*false/)
})

test('logger 提供 initLogDir；index.ts 顶部用 userData 初始化', () => {
  assert.match(read('main/core/logger.ts'), /initLogDir\s*\(/)
  const idx = read('main/index.ts')
  assert.match(idx, /logger\.initLogDir\(app\.getPath\('userData'\)\)/)
  // 初始化应早于单实例锁分支中的任何 logger 调用（出现在文件前 1/3）
  const pos = idx.indexOf('initLogDir')
  assert.ok(pos > 0 && pos < idx.length / 3, 'initLogDir 应位于 index.ts 顶部')
})

test('downloader：具备协议回退、镜像候选与 text/* 拒绝', () => {
  const src = read('main/core/downloader.ts')
  assert.match(src, /protocolVariants/)
  assert.match(src, /mirrors/)
  assert.match(src, /\^text\\\//)
  assert.match(src, /resolveLocation/)
  assert.match(src, /postJson/)
})

test('installer：非 exe/msi 不执行（zip 防御）', () => {
  const src = read('main/engine/installer.ts')
  assert.match(src, /runSilentInstall/)
  assert.match(src, /\\\.\(exe\|msi\)\$/)
  assert.match(src, /createDesktopShortcut/)
  assert.match(src, /archNoteFor/)
})

test('shared/types：ShortcutSpec / manualHint / OPTIONS 通道齐备', () => {
  const src = read('shared/types.ts')
  assert.match(src, /interface ShortcutSpec/)
  assert.match(src, /manualHint\?/)
  assert.match(src, /OPTIONS_GET:\s*'kd:options:get'/)
  assert.match(src, /OPTIONS_SET:\s*'kd:options:set'/)
  assert.match(src, /type:\s*'create-shortcut'/)
})
