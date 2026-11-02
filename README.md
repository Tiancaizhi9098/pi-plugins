# Pi / OMP Plugins

用于 [Pi](https://pi.dev/) 和 [oh-my-pi](https://github.com/can1357/oh-my-pi) 的插件合集。每个插件放在独立子目录，后续插件继续添加到本仓库。

| 插件 | 支持 | 功能 |
| --- | --- | --- |
| [model-system-prompts](plugins/model-system-prompts/README.md) | Pi、OMP | 列出可用模型，直接粘贴系统提示词，选择持续生效或按模型仅首轮生效 |

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

## 使用

输入 `/model-system`：

1. 从当前宿主的可用模型列表中选择模型。
2. 在多行编辑框中直接粘贴提示词。
3. 选择“持续生效”或“仅首轮生效”，保存。

无需创建或绑定 `APPEND_SYSTEM.md` 文件，也无需先切换对话模型。已有配置的模型可编辑文本、切换模式、查看状态、重置首轮记录或解除绑定。`/model-system list` 可以直接列出可用模型及配置状态。

Pi 和 OMP 的配置分别保存，各自管理会话中的首轮记录。安装本身不添加任何个人规则。详见 [使用说明](plugins/model-system-prompts/README.md)。

## 更新与卸载

```text
pi update --extensions
pi remove git:github.com/Tiancaizhi9098/pi-plugins

omp plugin upgrade pi-plugins
omp plugin uninstall pi-plugins
```

完成后重载 Pi 或重启 OMP。个人提示词配置不会被自动删除。

## 开发

验证环境：Pi 1.5.0、OMP 18.15.0、Node.js 24、Bun 1.4.3。开发要求 Node.js >= 22.19.0，并安装 Bun 以运行 OMP 测试。

```text
npm ci --ignore-scripts
npm test
npm run typecheck
```

测试使用真实宿主 SDK、临时配置目录和离线模型流，覆盖模型选择、粘贴保存、取消、持续/首轮模式、工具循环、自动重试与会话恢复。不会读取个人密钥或调用付费模型 API。

插件位于 `plugins/model-system-prompts/`；`src/index.ts` 是 Pi 入口，`src/omp.ts` 是 OMP 入口。也可以在该插件目录运行 `pi install .` 或 `omp plugin link .` 单独安装。

许可证：[MIT](LICENSE)。
