# Pi / OMP Plugins

用于 [Pi](https://pi.dev/) 和 [oh-my-pi](https://github.com/can1357/oh-my-pi) 的插件合集。每个插件放在独立子目录，后续插件继续添加到本仓库。

| 插件 | 支持 | 功能 |
| --- | --- | --- |
| [model-system-prompts](plugins/model-system-prompts/README.md) | Pi、OMP | 列出可用模型，直接粘贴系统提示词，选择持续生效或按模型仅首轮生效 |
| [goal-retry](plugins/goal-retry/README.md) | Pi | `/goal` 持续执行目标；断流和未知上游错误自动退避重试，连续失败最多重试 10 次，进度及重试状态随会话保存 |
| [temp-workspaces](plugins/temp-workspaces/README.md) | Pi | 每个临时对话使用独立目录；恢复对话保留文件；删除本机对话后自动清理 |

## 安装

Pi：

```text
pi install git:github.com/Tiancaizhi9098/pi-plugins
```

OMP：

```text
omp plugin install git:github.com/Tiancaizhi9098/pi-plugins
```

Pi 安装后执行 `/reload` 或重启；OMP 安装后重启。两种宿主通过各自的包入口加载对应适配器。

Pi 入口同时提供 `/model-system`、`/goal` 和 `/temp-work`；OMP 入口提供 `/model-system`。`goal-retry` 基于 `@narumitw/pi-goal 0.55.0`，会注册 `/goal`，请先移除其他 Goal 扩展的加载声明，避免重复命令。已有本地修改版也应只保留一个加载来源。

## 使用

### 临时对话工作目录（Pi）

在 `%TEMP%\Pi-Work` 中启动 Pi，扩展为每个对话分配独立子目录。`/new` 创建新目录，`/resume` 和 `pi -c` 继续使用原目录，`/temp-work` 显示完整路径及后台状态。目录名称默认不显示在底部状态栏。

可选的 [PowerShell 7 启动器](plugins/temp-workspaces/scripts/install-powershell7.ps1) 可以让 `pi` 在盘符根目录或用户主目录启动时自动进入 `Pi-Work`，在项目目录启动时保持当前目录。

关闭 Pi 保留文件；从 Pi 或 Magpie 删除本机 Pi 对话后，后台清理通常在 10–15 秒内完成，正在使用的目录会等到退出或切换后清理。清理过的工作文件不随 Magpie 聊天记录恢复。文件工具限制目录外写入，Shell 和 MCP 保持本机权限。安装、清理规则及卸载步骤见 [插件说明](plugins/temp-workspaces/README.md)。此插件只加入 Pi 入口。

### Goal 自动恢复（Pi）

```text
/goal 完成你的任务并验证结果
/goal status
/goal pause
/goal resume
```

遇到 `Antigravity: the reply ended before it was complete` 等上游失败时自动恢复。新增恢复采用 10 秒起步、最多 120 秒的指数退避；Pi 原生重试也计入同一段连续失败的 10 次上限。手动暂停会取消待执行的重试，重新加载同一会话会保留次数和原定时间。Token 预算、额度处理和明确拒绝仍有各自的停止条件。详见 [Goal Retry 说明](plugins/goal-retry/README.md)。

### 按模型设置系统提示词（Pi、OMP）

输入 `/model-system`：

1. 从当前宿主的可用模型列表中选择模型。
2. 在多行编辑框中直接粘贴提示词。
3. 选择“持续生效”或“仅首轮生效”，保存。

无需创建或绑定 `APPEND_SYSTEM.md` 文件，也无需先切换对话模型。已有配置的模型可编辑文本、切换模式、查看状态、重置首轮记录或解除绑定。`/model-system list` 可以直接列出可用模型及配置状态。

Pi 和 OMP 的配置分别保存，各自管理会话中的首轮记录。仅首轮模式在每次成功压缩对话后，会按模型重新注入一次；手动压缩和自动压缩都支持。OMP 的 Cursor 等不透明接口在压缩后的下一条用户消息生效，不支持当前任务自动续跑时即时补入。安装本身不添加任何个人规则。详见 [使用说明](plugins/model-system-prompts/README.md)。

## 更新与卸载

```text
pi update --extensions
pi remove git:github.com/Tiancaizhi9098/pi-plugins

omp plugin upgrade pi-plugins
omp plugin uninstall pi-plugins
```

完成后重载 Pi 或重启 OMP。个人提示词配置不会被自动删除。临时目录插件卸载前，应先停止其后台清理；安装过 PowerShell 启动目录配置的用户也应移除该配置块，详见[卸载步骤](plugins/temp-workspaces/README.md#安装和停止)。

## 开发

验证环境：模型提示词插件使用 Pi 1.5.0、OMP 18.15.0；Goal Retry 另通过本机 Pi 1.5.2 的会话集成验证。开发要求 Node.js >= 22.19.0，并安装 Bun 以运行 OMP 测试。

临时目录插件使用 Windows / PowerShell 7、Pi 1.5.0 / 1.5.2、Node.js 24 验证。GitHub Actions 在 Windows 和 Linux 上运行合集测试与类型检查，OMP 测试使用 Bun 1.4.3。

```text
npm ci --ignore-scripts
npm run build:goal
npm test
npm run typecheck
```

测试使用真实宿主 SDK、临时配置目录和离线模型流，覆盖模型选择、粘贴保存、取消、持续/首轮模式、工具循环、自动重试、会话恢复和压缩后重新注入。不会读取个人密钥或调用付费模型 API。

模型提示词插件位于 `plugins/model-system-prompts/`；`src/index.ts` 是 Pi 入口，`src/omp.ts` 是 OMP 入口。Goal Retry 位于 `plugins/goal-retry/`，提供源码、已构建入口、重试测试和上游许可。也可以在相应插件目录运行 `pi install .` 单独安装；OMP 只支持模型提示词插件。

临时工作目录插件位于 `plugins/temp-workspaces/`，可在该目录执行 `pi install .` 单独安装；`npm run test:temp-workspaces` 运行其目录管理、清理保护、真实工具、Pi RPC 会话切换及 PowerShell 配置安装/卸载测试。

许可证：[MIT](LICENSE)。
