# Pi 插件中心

按需独立安装，点击插件名称查看用法。

| 插件 | 功能 | Pi 安装命令 | OMP 安装命令 |
| --- | --- | --- | --- |
| [model-system-prompts](https://github.com/Tiancaizhi9098/pi-model-system-prompts) | 按模型保存系统提示词，支持持续生效或仅首轮生效 | `pi install git:github.com/Tiancaizhi9098/pi-model-system-prompts` | `omp plugin install git:github.com/Tiancaizhi9098/pi-model-system-prompts` |
| [auto-retry](https://github.com/Tiancaizhi9098/pi-auto-retry) | Retry ordinary Pi requests with a countdown, a Cancel button and a configurable limit | `pi install git:github.com/Tiancaizhi9098/pi-auto-retry` | — |
| [goal-retry](https://github.com/Tiancaizhi9098/pi-goal-retry) | 持续执行目标，上游失败后自动退避重试 | `pi install git:github.com/Tiancaizhi9098/pi-goal-retry` | — |
| [temp-workspaces](https://github.com/Tiancaizhi9098/pi-temp-workspaces) | PowerShell 7 从主目录或盘符根目录输入 `pi` 即进入 Pi-Work，临时文件随对话清理 | `pi install git:github.com/Tiancaizhi9098/pi-temp-workspaces` | — |

临时目录插件在新开的 PowerShell 7 标签页生效。当前窗口可在安装命令末尾加 `&& . $PROFILE.CurrentUserAllHosts` 立即启用。其他 Pi 插件安装后执行 `/reload` 或重启，OMP 安装后重启。已装过旧版 `pi-plugins` 合集的用户，先移除旧入口，再安装需要的独立插件，个人配置保留。
