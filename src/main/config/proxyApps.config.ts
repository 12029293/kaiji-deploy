/**
 * 翻墙软件配置（4 项，按桌面 生产力翻墙软件.txt）：
 *  - Clash Verge：GitHub releases 自动跟随最新版（原本地包）
 *  - 影策：仓库 release 无 Windows 安装包（自托管 Web 工作台）→ 源码部署包（main.zip）+ 解压 + 启动脚本快捷方式
 *  - WorkDaddy：国内版安装包（WorkDaddy-Setup-*，非国际版 WorkDaddy-AI-*）
 *  - workbuddy辅助工具：交付物为 zip → 解压部署
 * proxy 类统一由引擎注入安装目录参数安装到 D:\Apps\<id>（无 D 盘回退 C:\Apps）。
 */
import type { InstallConfig } from '@shared/types'

export const proxyAppsConfigs: InstallConfig[] = [
  {
    id: 'clash-verge',
    name: 'Clash Verge',
    category: 'proxy',
    source: {
      kind: 'github-release',
      repo: 'clash-verge-rev/clash-verge-rev',
      // 精确锚定 x64 安装包（原 \.(exe|msi|zip)$ 会命中 arm64/webview2 等 4 个资产）
      assetPattern: '^Clash\\.Verge_[\\d.]+_x64-setup\\.exe$'
    },
    silentArgs: '/S',
    degrade: 'none',
    homepage: 'https://github.com/clash-verge-rev/clash-verge-rev/releases/latest'
  },
  {
    id: 'yingce',
    name: '影策',
    category: 'proxy',
    // 本质为自托管 Web 工作台：release 只有 docker-compose + Linux 二进制，无 Windows 包
    // → 取源码包 main.zip 解压为部署目录，快捷方式指向仓库自带启动脚本
    source: { kind: 'direct-url', url: 'https://github.com/ddcat-ai/open-ai-canvas/archive/refs/heads/main.zip' },
    extractZip: '影策',
    silentArgs: undefined,
    // 目标为 .ps1：工具会自动以 powershell -ExecutionPolicy Bypass -File "<脚本>" 启动，
    // 这里不再重复填执行参数；main.zip 解压后会多一层 open-ai-canvas-main\，
    // 由 shortcutService 递归按 basename 兜底查找定位。
    shortcut: { target: 'scripts\\start-local.ps1' },
    degrade: 'none',
    homepage: 'https://github.com/ddcat-ai/open-ai-canvas'
  },
  {
    id: 'workdaddy',
    name: 'WorkDaddy',
    category: 'proxy',
    source: {
      kind: 'github-release',
      repo: 'babygoton/WorkDaddy',
      // 国内版（腾讯 WorkBuddy）安装包；排除 WorkDaddy-AI-*（国际版）与便携 zip
      assetPattern: '^WorkDaddy-Setup-[\\d.]+\\.exe$'
    },
    silentArgs: '/VERYSILENT /NORESTART',
    degrade: 'none',
    homepage: 'https://github.com/babygoton/WorkDaddy/releases/latest'
  },
  {
    id: 'workbuddy-panel',
    name: 'workbuddy辅助工具',
    category: 'proxy',
    source: {
      kind: 'github-release',
      repo: 'linguo2625469/workbuddy2api-panel',
      assetPattern: '^wb2api-panel-[^/]*-windows-amd64\\.zip$'
    },
    extractZip: 'workbuddy辅助工具',
    silentArgs: undefined,
    degrade: 'none',
    homepage: 'https://github.com/linguo2625469/workbuddy2api-panel/releases/latest'
  }
]
