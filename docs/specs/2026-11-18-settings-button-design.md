# code-hud：settings.json 按钮 —— 简短设计

## 意图
在状态条第二行 `hooks N` 后面加一个 `settings.json` 按钮，和 CLAUDE.md 按钮一样打开面板列表，
让用户不用翻目录就能查看用户级和项目级的 settings 文件，并一键用 Warp 打开编辑。

## 目标
- 列出的文件（只列存在的文件）：
  - 用户级 `~/.claude/settings.json`（正常情况下总是存在，所以总会列出）
  - 项目级 `<会话工作目录>/.claude/settings.json`
  - 项目级 `<会话工作目录>/.claude/settings.local.json`
  - 项目级一个都没有时，列表里只有用户级这一行
  - 会话工作目录就是 HOME 时，没有项目级，只列用户级（路径显示为 `~/.claude/settings.json`）
- 状态条按钮和面板标签：`settings.json N`，N 为列出的文件数，写法和 `CLAUDE.md N` 一致
- 每行和 CLAUDE.md 列表同款：第一行是级别标签 + 路径（用 `~` / `.` 缩写，过长时中间截断），第二行是 `查看`、`Warp` 两个按钮
- 级别标签：`用户级`（蓝）、`项目级`（绿）、`项目级·本地`（绿）
- `查看`：进入现有文件页，用 `<Code language="json">` 只读显示
  - 文件页顶部仍然是 `返回`、`刷新`、路径、外部打开按钮
  - 外部打开按钮：settings 文件显示 `Warp`，CLAUDE.md 仍显示 `Obsidian`
  - `返回` 回到进入前的列表（settings 回 settings 标签，CLAUDE.md 回 CLAUDE.md 标签）
  - 超长时的提示语按文件类型写"其余部分请在 Warp / Obsidian 里查看"
- `Warp`：执行 `open -a Warp <文件>`，进入 Warp 自带的编辑器；失败时用 toast 提示原因（和现有 Warp/Obsidian 按钮一致）
- 面板窄条（widget）里的计数行加上 `settings.json N`

## 非目标
- 不在面板里编辑，也不新建不存在的文件
- 不列 `~/.claude/settings.local.json`、managed/policy 设置
- 不对 settings 内容打码，原样显示（见"风险"）
- 不改现有状态条 `Warp` 按钮（它仍然打开项目目录）

## 约束
- 文件页的安全闸：只允许读已加载的 CLAUDE.md，以及本次收集到的 settings 路径；其他路径一律拒绝
- 渲染函数保持纯函数（不用 `$`、不 await）；状态写入前先比较，内容没变就不写
- 新增状态值 `settings` 要在 `types/index.d.ts` 里声明，并带 shape 版本号；`View` 增加 `'settings'`。旧的 `ui` 值仍然合法，不需要改 ui 的 shape
- 状态条第二行变宽：`counts` 段的估计宽度要加上新按钮（约 +16 列），否则窄窗口里会挤在一起

## 刷新时机
和 CLAUDE.md 列表一样：模组启动时、每轮结束时、点状态条按钮或面板标签时；另外，工作目录变更（`CwdChanged`）时立即刷新。
多次刷新重叠时，只写入最后一次发起的结果。
新建或删除一个项目 settings 文件后，在以上任一时机就会出现或消失。

## 方案（已选 A）
- **A（选用）**：新增 `settings` 状态值和 `settings` 视图，复用文件页。和现有结构一致，改动分散但都很小。
- B：把 settings 塞进 CLAUDE.md 列表。不符合"独立按钮"的要求。
- C：渲染时临时检查文件是否存在，不存状态。每次重绘都要多跑三次文件检查，计数会抖动。

## 风险
- hooks 标签里的命令显示前会脱敏（去掉 token、header 等），但 settings 查看页显示的是原文。
  以后如果 settings 里放了密钥或带 token 的 hook 命令，会在面板里明文出现。用户已确认按原样显示。

## 由我决定的点（可改）
- "项目目录"取 `$.session.root()`（会话工作目录），也就是 Claude Code 读项目 settings 的位置
- 文件页是 settings 文件还是 CLAUDE.md，靠路径属于哪个列表来判断
- 级别标签用中文（用户级 / 项目级 / 项目级·本地），和对话里的叫法一致
