/**
 * 微信输入法清理（P0-8）：安装成功后删除系统其他输入法，
 * 仅保留「微信输入法（zh-* 下非微软内置的第三方 TIP）+ 默认英文键盘（0409:00000409）」。
 * 方案：Get/Set-WinUserLanguageList 过滤 InputMethodTips（ARCH UNCLEAR 2 已确认边界）。
 */
import { execPS } from '../core/shellRunner'
import { logger } from '../core/logger'

/** 微软内置中文 TIP GUID（清理对象：微软拼音/双拼、微软五笔、简捷等） */
const MS_ZH_TIP_GUIDS = [
  '81D4E9C9-1D3B-41BC-9E6C-4B40BF79E35E', // Microsoft Pinyin
  'FA550B04-5AD7-411F-A5AC-CA038EC515D7', // Microsoft Pinyin（旧版）
  '4BDF9F03-C7D3-4B2C-9DE8-6DE6B9A8DBA8' // Microsoft Wubi
]

export interface ImeCleanupResult {
  removed: string[]
}

class ImeService {
  async cleanup(): Promise<ImeCleanupResult> {
    const known = MS_ZH_TIP_GUIDS.map((g) => `'${g}'`).join(',')
    const script = [
      '$known = @(' + known + ')',
      '$old = Get-WinUserLanguageList',
      '$oldTips = @($old | ForEach-Object { $_.InputMethodTips })',
      '$new = @()',
      'foreach ($lang in $old) {',
      "  if ($lang.LanguageTag -match '^en') {",
      "    $lang.InputMethodTips = @('0409:00000409')",
      '    $new += $lang',
      "  } elseif ($lang.LanguageTag -match '^zh') {",
      "    $keep = @($lang.InputMethodTips | Where-Object { $_ -match '^\\{' -and $known -notcontains ($_ -replace '^\\{|\\}.*$','') })",
      '    if ($keep.Count -gt 0) { $lang.InputMethodTips = $keep }',
      '    $new += $lang',
      '  }',
      '}',
      'Set-WinUserLanguageList -LanguageList $new -Force',
      '$after = @($new | ForEach-Object { $_.InputMethodTips })',
      '$removed = @($oldTips | Where-Object { $after -notcontains $_ })',
      '"REMOVED=" + ($removed -join ",")',
      '"AFTER=" + (($new | ForEach-Object { "$($_.LanguageTag): $($_.InputMethodTips -join \', \')" }) -join " | ")'
    ].join('\n')

    logger.info('ime', '开始清理输入法（保留微信输入法 + 默认英文键盘）')
    const res = await execPS(script, { timeoutMs: 120_000 })
    if (res.code !== 0) {
      const msg = res.stderr.trim() || `退出码 ${res.code}`
      logger.error('ime', `输入法清理失败: ${msg}`)
      throw new Error(`输入法清理失败: ${msg}`)
    }
    const removedLine = res.stdout.split('\n').find((l) => l.startsWith('REMOVED=')) ?? 'REMOVED='
    const afterLine = res.stdout.split('\n').find((l) => l.startsWith('AFTER=')) ?? 'AFTER='
    const removed = removedLine
      .replace('REMOVED=', '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    logger.info('ime', `输入法清理完成。移除: ${removed.join(', ') || '无'}；${afterLine.replace('AFTER=', '')}`)
    return { removed }
  }
}

export const imeService = new ImeService()
