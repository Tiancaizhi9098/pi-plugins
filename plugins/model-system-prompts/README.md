# 模型系统提示词：Pi / OMP

为每个模型独立保存一段系统提示词，选择**持续生效**或**仅首轮生效**。直接在多行编辑框中粘贴文本，无需创建 `APPEND_SYSTEM.md` 文件。

已使用 Pi 1.5.0 和 OMP 18.15.0 的真实 SDK 验证。Pi 需要 Node.js >= 22.19.0；OMP 使用自身的 Bun 运行时。

## 安装

先克隆仓库并进入根目录：

```powershell
git clone https://github.com/Tiancaizhi9098/pi-plugins.git
cd pi-plugins
```

Pi：

```text
pi install ./plugins/model-system-prompts
```

OMP：

```text
omp plugin install ./plugins/model-system-prompts
```

安装后，Pi 执行 `/reload` 或重启；OMP 重启。本插件声明了 `pi.extensions`、`omp.extensions`，宿主只加载自己的适配器。

如已克隆仓库，也可以在 `plugins/model-system-prompts` 目录运行 `pi install .` 或 `omp plugin link .`。本地链接安装后应保留源码目录。

## 直接粘贴

1. 输入 `/model-system`，看到当前宿主的可用模型列表。
2. 选中要配置的模型。列表显示“提供商/模型ID”、名称、当前模型标记和配置模式。
3. 在多行编辑框粘贴提示词，确认保存。
4. 选择“持续生效”或“仅首轮生效”。文本和模式一起保存。

选择其他模型进行配置不会切换当前对话模型。模型列表来自宿主运行时，随模型配置和登录状态变化，包含自定义提供商；OMP 还遵循当前会话的 `enabledModels` 范围。不同提供商下的同名模型独立保存。

已经配置的模型会先显示操作菜单，可编辑提示词、切换模式、查看状态、重置首轮记录或解除绑定。编辑器会带出原文本。取消任意一步都不会写入，空白提示词不会覆盖已有内容。

| 命令 | 功能 |
| --- | --- |
| `/model-system` | 从可用模型列表选择模型并配置 |
| `/model-system list` | 列出可用模型和配置状态，也显示暂不可用的已有配置 |
| `/model-system edit [提供商/模型ID]` | 打开多行编辑器，省略模型时编辑当前模型 |
| `/model-system status [模型]` | 查看模式、首轮状态和配置位置 |
| `/model-system mode always [模型]` | 改为持续生效 |
| `/model-system mode once [模型]` | 改为仅首轮生效 |
| `/model-system reset [模型]` | 重置本会话中该模型的首轮记录 |
| `/model-system unbind [模型]` | 删除该模型的提示词配置 |
| `/model-system help` | 命令帮助 |

`[模型]` 都是可省略的精确 `提供商/模型ID`。无交互界面时，默认命令列出模型；编辑文本请使用宿主交互界面。运行中的任务结束后才能修改配置。

## 生效规则

**持续生效（always）**：该模型每个用户任务都附带已保存的提示词，同一任务内的工具调用继续携带。编辑后下一个任务生效，不会逐轮累加。

**仅首轮生效（once）**：按 `提供商/模型ID`，在当前会话分支中第一次成功使用这段规则的完整用户任务生效，包括该轮工具调用和自动重试。从下一轮开始不再附带；**每次成功压缩对话后，每个模型重新获得一次注入机会**。OMP 自动回退到其他模型时，按实际请求模型选择提示词并独立计数。

| 操作（A、B 均为 once） | 追加规则 |
| --- | --- |
| 首次使用 A | A 的规则 |
| 继续使用 A | 无 |
| 首次使用 B | B 的规则 |
| 切回 A | 无 |
| 压缩成功后再次使用 A | A 的规则 |
| 压缩后继续使用 A | 无 |
| 压缩后首次使用 B | B 的规则 |
| 新建会话后使用 A | A 的规则 |

首个成功响应（含工具调用）后视为已使用；首次成功响应之前失败或取消，保留首轮资格。已有成功工具调用后再取消，不恢复资格。

首轮记录保存在宿主会话的自定义记录中，不发送给模型。恢复会话或重新加载插件保留记录；新会话独立计数；会话分支继承其路径上已有的记录。首轮资格按最近一次成功压缩后的使用记录计算。手动压缩和自动压缩都重置资格；压缩失败或取消不重置。支持请求改写的接口在自动溢出压缩后的立即重试也会重新携带提示词，无需再发送一条消息；OMP 的 Cursor 等不透明接口例外，见下方兼容说明。回退到旧分支时，遵循该分支上的压缩与使用记录。

修改文本、切换模式、解除后重新配置都不清除首轮记录。如果自本次会话开始或最近一次压缩以来已在 always 模式成功生效过，再改为 once，也视为已使用；需要再次触发时执行 `/model-system reset`。安装前和未配置时的模型使用不计数。

插件不会把提示词原文作为聊天消息保存。Pi 的系统消息历史只保留空占位标记，实际文本在发送请求前补入。仅首轮模式的后续请求不再主动附带该文本，但前一轮回答和工具执行产生的影响仍然存在。

## 配置保存

- Pi：`~/.pi/agent/model-system-prompts.json`
- OMP：当前 agent/profile 目录下的 `model-system-prompts.json`，默认 `~/.omp/agent/model-system-prompts.json`

遵循宿主的自定义目录设置（如 `PI_CODING_AGENT_DIR`）。两种宿主分别保存，互不覆盖。文件在首次保存时创建，不写入仓库。

```json
{
  "version": 1,
  "bindings": {
    "provider-a/model-a": {
      "prompt": "请使用中文回答。\n先说明结论，再解释。",
      "mode": "always"
    },
    "provider-b/model-b": {
      "prompt": "首次使用时先梳理任务目标。",
      "mode": "once"
    }
  }
}
```

通常只需使用菜单。手动修改配置后，下次任务读取新内容。配置损坏时会提示错误并跳过注入，不消耗首轮资格，也不覆盖原文件。

旧版 Pi 的 `file` 绑定仍可读取。选择“编辑提示词”会载入旧文件内容，保存后转换为内嵌 `prompt` 文本；之后不再依赖该文件。

## 与原生规则和其他插件共存

插件保留宿主原生系统提示词和其他扩展的追加内容。原生 `APPEND_SYSTEM.md` 继续按宿主机制加载，不受本插件的 once 模式控制。

如果还使用旧的 OMP `omp-model-toolkit`，其 `/model-prompts` 是另一套独立配置。请避免在两处重复配置相同规则；旧插件持续注入的内容不会因本插件设为 once 而消失。本插件使用 `/model-system` 命令，不修改旧插件的模型白名单或配置。

OMP 的回合内换模适配覆盖 OpenAI/Codex、Anthropic/Bedrock、Google、Apple 和 Devin 的系统提示词字段。对于无法改写系统字段的特殊或自定义传输（如 Cursor 的不透明请求），涉及已配置提示词的自动回退会中止并提示手动切换后重发，避免把前一个模型的规则发给另一个模型。

这些不透明接口也无法在自动压缩后的当前任务续跑中即时补入提示词：首轮资格会恢复，在你下一次发送消息时重新注入。手动压缩后发送消息正常生效；自动续跑未注入时不会消耗恢复的资格。

## 卸载

```text
pi remove ./plugins/model-system-prompts
omp plugin uninstall pi-model-system-prompts
```

以上 Pi 命令在原克隆仓库根目录执行，也可传入插件目录的绝对路径；OMP 的包名为 `pi-model-system-prompts`。随后重载或重启宿主。个人配置保留。

## 开发验证

在插件目录执行：

```text
npm ci --ignore-scripts
npm test
npm run typecheck
npm pack
```

测试需要 Node.js 和 Bun，使用临时配置和离线模型流。运行时只有 Node 内置模块与宿主提供的接口；两套 SDK 仅用于开发测试。

接口依据：[Pi 扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)、[OMP 扩展文档](https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md)、[OMP 插件管理](https://github.com/can1357/oh-my-pi/blob/main/docs/plugin-manager-installer-plumbing.md)。
