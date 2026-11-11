# Pi / OMP 插件

先克隆仓库并进入目录，再执行表中需要的安装命令：

```powershell
git clone https://github.com/Tiancaizhi9098/pi-plugins.git
cd pi-plugins
```

| 插件 | 功能 | Pi 安装命令 | OMP 安装命令 |
| --- | --- | --- | --- |
| [model-system-prompts](plugins/model-system-prompts/README.md) | 按模型保存系统提示词，支持持续生效或仅首轮生效 | `pi install ./plugins/model-system-prompts` | `omp plugin install ./plugins/model-system-prompts` |
| [goal-retry](plugins/goal-retry/README.md) | 持续执行目标，上游失败后自动退避重试，状态随会话保存 | `pi install ./plugins/goal-retry` | — |
| [temp-workspaces](plugins/temp-workspaces/README.md) | 每个临时对话使用独立目录，删除本机对话后自动清理 | `pi install ./plugins/temp-workspaces` | — |

Pi 安装后执行 `/reload` 或重启，OMP 安装后重启。本地安装会引用源码目录，请保留仓库。详细用法点击插件名称。
