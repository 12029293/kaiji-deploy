# 开机部署助手

新机 / 重装系统后的**一键环境部署工具**（Windows 桌面端，Electron + React + Tailwind）。

装完系统不用再一个个下安装包：勾选要装的软件与要做的系统设置，点一次「开始安装」，剩下的交给它。

## 功能模块

| 模块 | 内容 |
|---|---|
| 概览 | 系统信息一览 + 各模块完成度 |
| 开发环境 | Node.js、Git、Python 等开发链路一键就位 |
| 日常软件 | 浏览器、播放器、压缩工具等常用软件批量安装 |
| 代理工具 | 代理客户端安装与系统代理开关 |
| 浏览器定制 | 主页、标签页等浏览器偏好设置 |
| 系统工具 | 激活、更新管控、图标缓存等系统级磁贴 |
| 壁纸 | 本机素材库 + 在线壁纸源，一键设置桌面 |

## 本地开发

```bash
npm install        # 安装依赖
npm run dev        # 开发模式
npm run build      # 构建
npm run typecheck  # 类型检查
npm run dist       # 打包安装程序（electron-builder）
```

要求：Node.js ≥ 18、Windows 10/11。

## 目录结构

```
src/
  main/       # 主进程：下载、安装、系统设置、配置清单
  preload/    # 预加载桥接
  renderer/   # 渲染层：React 页面与组件
  shared/     # 主/渲染共享类型
docs/ui-concept/   # UI 概念设计稿与逐页截图
tests/             # 测试
scripts/           # 辅助脚本
```

## 说明

- 软件清单集中在 `src/main/config/`，加软件改配置即可，无需动逻辑。
- UI 设计语言见 `docs/ui-concept/`（玻璃拟态 · 冷蓝调）。

## License

MIT
