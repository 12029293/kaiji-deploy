/**
 * 日常软件模块：注册全部安装配置并暴露清单。
 * 特殊落地规则以 InstallConfig.postActions / downloadDir / renameTo / extractZip 声明，
 * 由统一安装引擎（engine/installer.ts）解释执行：
 *  - Geek / IDM破解 → 桌面重命名（installer.resolveAndDownload）
 *  - 动漫共和国 → zip 解压（installer.finishInstall）
 *  - 无界趣连 → set-autostart（installer.runPostActions）
 *  - 微信输入法 → cleanup-ime → imeService
 */
import { taskQueue } from '../core/taskQueue'
import { appsConfigs } from '../config/apps.config'
import { devEnvConfigs } from '../config/devEnv.config'
import { proxyAppsConfigs } from '../config/proxyApps.config'

class DailyAppsService {
  /** 应用启动时注册全部模块配置（devenv + daily + proxy） */
  registerAll(): void {
    taskQueue.registerConfigs([...devEnvConfigs, ...appsConfigs, ...proxyAppsConfigs])
  }

  /** 日常软件清单（含全部模块配置，按 category 过滤在 renderer 侧完成） */
  getConfigs(): typeof appsConfigs {
    return appsConfigs
  }
}

export const dailyAppsService = new DailyAppsService()
