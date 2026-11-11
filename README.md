# Pi 插件中心

按需独立安装，每个插件有自己的仓库。

## Goal Retry

让 Pi 持续完成目标，上游断流或请求失败时自动退避重试，默认最多重试 10 次。

```text
pi install git:github.com/Tiancaizhi9098/pi-goal-retry
```

[仓库与使用说明](https://github.com/Tiancaizhi9098/pi-goal-retry)

## 模型系统提示词

为每个模型分别保存系统提示词，可选持续生效或仅首轮生效。

Pi：

```text
pi install git:github.com/Tiancaizhi9098/pi-model-system-prompts
```

OMP：

```text
omp plugin install git:github.com/Tiancaizhi9098/pi-model-system-prompts
```

[仓库与使用说明](https://github.com/Tiancaizhi9098/pi-model-system-prompts)

## 临时工作目录

为每个 Pi 临时对话创建独立目录，恢复对话时保留文件，删除对话后自动清理。

```text
pi install git:github.com/Tiancaizhi9098/pi-temp-workspaces
```

[仓库与使用说明](https://github.com/Tiancaizhi9098/pi-temp-workspaces)

Pi 安装后执行 `/reload`，OMP 安装后重启。已装过旧版 `pi-plugins` 合集的用户，先卸载旧入口，再安装需要的独立插件；个人配置保留。
