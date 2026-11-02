# Pi Plugins

用于 [Pi coding agent](https://pi.dev/) 的插件合集。每个插件放在独立子目录，后续插件继续添加到本仓库。

## 插件目录

| 插件 | 功能 | 文档 |
| --- | --- | --- |
| `model-system-prompts` | 为每个模型独立绑定 `APPEND_SYSTEM.md`，支持持续生效或按模型仅首轮生效 | [使用说明](plugins/model-system-prompts/README.md) |

## 安装

```text
pi install git:github.com/Tiancaizhi9098/pi-plugins
```

然后在 Pi 中执行 `/reload`，或重启 Pi。仓库根目录提供 Pi package 入口，目前包含模型系统提示词插件。

安装完成后，用 `/model` 选择模型，再输入 `/model-system` 打开中文菜单，绑定文件并选择生效模式。安装本身不会自动绑定或注入任何模型规则。

如需管理启用的插件，可运行 `pi config`。也可以克隆本仓库后单独安装某个插件目录：

```text
git clone https://github.com/Tiancaizhi9098/pi-plugins.git
pi install ./pi-plugins/plugins/model-system-prompts
```

## 更新与卸载

```text
pi update --extensions
pi remove git:github.com/Tiancaizhi9098/pi-plugins
```

完成后执行 `/reload`。个人提示词文件和插件配置不会被自动删除。

## 仓库结构

```text
pi-plugins/
├── package.json                 # 插件合集的 Pi 安装入口
└── plugins/
    └── model-system-prompts/
        ├── src/                 # 插件实现
        ├── tests/               # 离线测试
        ├── examples/            # 提示词示例
        ├── package.json         # 单独安装入口
        └── README.md            # 详细说明
```

## 开发验证

要求 Node.js >= 22.19.0；当前插件针对 Pi 1.5.0 验证。

```text
npm ci --ignore-scripts
npm test
npm run typecheck
```

18 项测试覆盖模型独立绑定、持续/首轮注入、工具循环、自动重试、恢复、重载、压缩和配置错误。测试使用真实 Pi SDK 和离线模型流，不调用付费模型 API。

许可证：[MIT](LICENSE)。
