# Code HUD

Claude 桌面应用 Code 标签页的一个 mod：在输入框上方显示一条状态带，并提供一个详情面板。只在桌面端绘制，终端会话里不显示任何东西。

## 它显示什么

**条带（输入框上方，两行）**

- 第一行：模型名、项目名与分支、上下文用量、5 小时限额用量与重置时间、权限模式。
- 第二行：已加载的 CLAUDE.md 数量、MCP 服务数量、hooks 数量、settings.json 数量（点击打开面板），以及 Obsidian、Warp 两个一键打开的按钮。
- 右侧：一个随会话状态变化的像素小人。

**面板**

- CLAUDE.md：会话实际加载的文件列表；可查看 Markdown 渲染的原文，可在 Obsidian 里打开。
- MCP：每个服务的名称、作用、工具数；可进入详情看工具清单。
- hooks：按来源分组，显示事件、匹配器、名称和一句作用说明；点开某一条可看它的命令。
- settings.json：列出存在的设置文件——用户级 `~/.claude/settings.json`，以及当前项目的 `.claude/settings.json`、`.claude/settings.local.json`；可只读查看 JSON 原文，可在 Warp 里打开编辑。会话目录就是 HOME 时只列用户级。

## 安装

在终端会话的提示符下：

```
/plugin install code-hud --marketplace tengjia0610-dotcom/code-hud
```

之后按提示操作：先回答 `y` 添加这个市场，再选择安装范围（第一项是用户范围，按回车）。

在 shell 里：

```
claude plugin install code-hud --marketplace tengjia0610-dotcom/code-hud
```

在桌面应用里（那里不能运行 `/plugin`）：点输入框旁边的 +，选 Plugins，用 `tengjia0610-dotcom/code-hud` 添加市场（Add marketplace），再添加插件（Add plugin）。

这是一个私有仓库：只有在 GitHub 上能读到它、并且电脑上已经配置好 github.com 的 git 凭据（SSH 密钥，或 `gh auth login` 后执行 `gh auth setup-git`）的人才能安装，安装过程不会提示输入凭据。

## 升级

仓库有新版本后，先刷新市场，再更新插件，然后重启会话生效：

```
claude plugin marketplace update code-hud
claude plugin update code-hud
```

## 使用前提

- macOS 上的 Claude 桌面应用。
- Obsidian 和 Warp 是可选的：没有安装时，对应按钮按下后只会提示一次，条带照常显示。
- "在 Obsidian 里打开"会在当前打开的 vault 的 `Claude/` 文件夹里建一个指向原文件的软链接，原文件不会被移动或复制。

## 它不做什么

- 不调用模型，不修改任何 CLAUDE.md、MCP、hooks 或设置。
- hook 的命令文本只在点开时读取并显示，不保存。显示前会去掉内联命令体、请求头、账号参数、名字像密钥的参数的值，以及网址里的账号和查询串；写法特殊的密钥仍可能原样显示，请留意。
- settings.json 的内容不打码，按原文显示：如果设置文件里写了 token 或密钥（例如 `env` 里的值），打开查看时会直接显示出来，共享屏幕时请留意。
- 不在面板里编辑设置文件，也不会新建不存在的文件；编辑请用 Warp 打开。

## 卸载

```
claude plugin uninstall code-hud
```

如果用过"在 Obsidian 里打开"，vault 的 `Claude/` 文件夹里会留有软链接，可以手动删除。
