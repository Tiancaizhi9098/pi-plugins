# Pi 模型系统提示词插件

为每个模型绑定独立的 `APPEND_SYSTEM.md`，选择**持续生效**或**仅首轮生效**。已使用 Pi 1.5.0 的真实 SDK 做离线集成验证，要求 Node.js >= 22.19.0。

## 安装

直接从 GitHub 安装：

```text
pi install git:github.com/Tiancaizhi9098/pi-plugins
```

以上命令安装插件合集，当前包含本插件。如果已下载或克隆源码，也可以在 `plugins/model-system-prompts` 目录单独安装：

```text
pi install .
```

然后在已打开的 Pi 会话中执行 `/reload`，或重启 Pi。安装仅加载插件，不会自动给任何模型添加规则。

也可以使用绝对路径：

```powershell
pi install "C:\Projects\pi-plugins\plugins\model-system-prompts"
```

若拿到 `.tgz` 安装包，先解压，再运行 `pi install <解压后的 package 目录>`。本地安装引用该目录，请保留它。

## 快速使用

1. 用 Pi 的 `/model` 选择要配置的模型。
2. 准备该模型专属的提示词文件，例如 `C:/PiPrompts/model-a/APPEND_SYSTEM.md`。
3. 输入 `/model-system` 打开中文菜单，选择“绑定当前模型”，再选择生效模式和文件。
4. 切换到其他模型，重复绑定。不同模型可以绑定不同文件，也可以共享一个文件。

也可直接使用命令：

```text
/model-system bind always "C:/PiPrompts/model-a/APPEND_SYSTEM.md"
/model-system bind once "C:/PiPrompts/model-b/APPEND_SYSTEM.md"
```

每条命令都作用于**当前选中的模型**。运行第二条前，应先切换到 model-b。路径可以包含中文和空格，支持 Windows 反斜杠、`~/` 和相对路径；命令中的相对路径基于 Pi 当前工作目录。

| 命令 | 功能 |
| --- | --- |
| `/model-system` | 中文菜单；无交互界面时显示状态 |
| `/model-system status` | 当前模型、绑定文件、模式、首轮状态和配置路径 |
| `/model-system list` | 列出全部模型绑定 |
| `/model-system bind always <文件>` | 绑定当前模型，持续生效 |
| `/model-system bind once <文件>` | 绑定当前模型，仅首轮生效 |
| `/model-system mode always` | 将当前绑定改为持续生效 |
| `/model-system mode once` | 将当前绑定改为仅首轮生效 |
| `/model-system reset` | 让当前模型的首轮规则可以再次使用 |
| `/model-system unbind` | 解除当前模型绑定 |
| `/model-system help` | 命令帮助 |

## 两种模式

**持续生效（always）**：该模型每个用户发起的任务都携带文件内容。同一任务内的多次推理和工具调用继续携带。每次任务只附带一份，不会逐轮累积。文件内容在每次需要注入时读取，修改文件后下次任务生效。

**仅首轮生效（once）**：该模型在当前会话分支中首次成功使用绑定规则的整轮任务携带内容，包括该轮的工具调用。从下一轮开始不再附带这段系统提示词。

例如 A、B 都设为 once：

| 操作 | 追加的模型规则 |
| --- | --- |
| 首次使用 A | A 的规则 |
| 继续使用 A | 无 |
| 首次切到 B | B 的规则 |
| 切回 A | 无 |
| 开启新会话后使用 A | A 的规则 |

“首轮”指一轮用户任务，而不是一次底层 API 调用。插件不会把提示词原文作为聊天消息保存：后续请求确实不再附带它；先前回答或工具操作造成的间接影响仍然存在。

首轮状态保存在 Pi 会话的自定义记录中，该记录不发送给模型：

- 恢复会话、`/reload`、压缩上下文不会自动重新触发。
- 新会话独立计数；分支继承当前路径上已有的记录，回退至首次使用之前可以再次触发。
- 首个成功响应（含工具调用）后视为已使用。首次响应前失败或取消，可以下次重试；已有成功工具调用后的取消不恢复资格。
- 变更文件、改模式、解除后重新绑定不会清除已有记录。如需重新触发，请执行 `/model-system reset`。
- 如果此前在 always 模式成功注入过，改为 once 时视为首轮已使用，可以用 reset 重置。
- 插件安装前或未绑定时的模型使用不计数。后台扩展通过 custom message 触发的任务不注入、不消耗资格。

## 文件与原生 APPEND_SYSTEM.md

推荐结构：

```text
~/.pi/agent/model-prompts/
├── model-a/
│   └── APPEND_SYSTEM.md
└── model-b/
    └── APPEND_SYSTEM.md
```

文件名可以是 `APPEND_SYSTEM.md`，也可以是其他 Markdown 文件。插件**追加**规则，并保留 Pi 原有系统提示词、项目规则和先前扩展的提示词。

Pi 原生的 `~/.pi/agent/APPEND_SYSTEM.md` 和项目 `.pi/APPEND_SYSTEM.md` 继续按 Pi 自身机制加载。不要将它们用作模型专属文件：原生机制会持续携带它们，导致仅首轮模式无法成立。插件会拒绝绑定这两个自动加载路径；请使用上述独立子目录。手动通过 Pi `--append-system-prompt` 加载的文件也不应再绑定到本插件。

## 配置文件

默认保存在 `~/.pi/agent/model-system-prompts.json`。设置了 `PI_CODING_AGENT_DIR` 时，改为该目录中的同名文件。文件在首次绑定时创建。

```json
{
  "version": 1,
  "bindings": {
    "provider-a/model-a": {
      "file": "./model-prompts/model-a/APPEND_SYSTEM.md",
      "mode": "always"
    },
    "provider-b/model-b": {
      "file": "./model-prompts/model-b/APPEND_SYSTEM.md",
      "mode": "once"
    }
  }
}
```

键是精确的 `提供商/模型ID`，可从 `/model-system status` 查看；同名模型在不同提供商下不会串用绑定。JSON 中的相对路径以**配置文件所在目录**为基准。通过命令绑定时保存绝对路径。建议 JSON 路径用 `/`，若用 `\` 需写成 `\\`。

配置每轮读取，手工修改后下次任务即可生效。多个会话共享绑定配置，各自维护首轮记录。文件丢失、空文件或配置损坏会明确提示，跳过当轮注入，Pi 任务继续执行且不会消耗首轮资格；请修复文件后重试。

## 卸载

```text
pi remove git:github.com/Tiancaizhi9098/pi-plugins
```

本地路径安装则使用 `pi remove "安装时使用的插件目录绝对路径"`。随后 `/reload`。个人配置和提示词文件保留，需要时可自行删除。

## 开发验证

```text
npm ci --ignore-scripts
npm test
npm run typecheck
npm pack
```

测试使用真实 Pi SDK、临时配置目录和离线模型流，不读取个人密钥，也不调用付费模型 API。运行时只使用 Node 内置模块和 Pi 提供的接口。

接口依据：[Pi 扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)、[Pi 包文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)。
