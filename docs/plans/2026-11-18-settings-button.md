# settings.json 按钮 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 code-hud 状态条第二行和面板里加 `settings.json N` 按钮/标签，列出用户级与项目级 settings 文件，可在面板里只读查看，并能用 Warp 打开编辑。

**Architecture:** 新增 `$.state` 值 `settings`（存在的 settings 文件列表），由 `collectSettings` 收集，刷新时机与 CLAUDE.md 列表相同。面板新增 `settings` 视图，复用现有 `file` 视图：文件属于哪个列表，就决定用 Markdown 还是 json 代码块显示、外部打开按钮是 Obsidian 还是 Warp、返回到哪个标签。Warp 复用现有的 `openWarp($, path)`（即 `open -a Warp <path>`）。

**Tech Stack:** TypeScript/TSX 模组（Claude Code mods API），测试用 `claude-code/testing`，由 `claude plugin test` 运行。

**Spec:** `docs/specs/2026-11-18-settings-button-design.md`

**模组目录：** `/Users/jet/.claude/mods/code-hud`（下文路径都相对于它）。该目录**不是 git 仓库**，所以没有提交步骤；每个任务以"测试 + tsc 通过"作为检查点。

## Global Constraints

- 列出的文件（只列存在的，顺序固定）：`<HOME>/.claude/settings.json`（user）、`<root>/.claude/settings.json`（project）、`<root>/.claude/settings.local.json`（local）；`root = $.session.root()`
- 按钮和标签文字：`settings.json ${n}`；状态条按钮 key 为 `band-settings`，排在 `band-hooks` 之后；面板标签 key 为 `tab-settings`，排在 `tab-hooks` 之后
- 级别标签：user → `用户级`（`COLORS.blue`），project → `项目级`（`COLORS.green`），local → `项目级·本地`（`COLORS.green`）
- 行按钮文字：`查看`、`Warp`；文件页的外部打开按钮：settings 文件显示 `Warp`，CLAUDE.md 显示 `Obsidian`
- settings 文件内容用 `<Code source=… language="json" />` 显示，原样不打码；超长时的提示语为 `文件较长，其余部分请在 Warp 里查看`（CLAUDE.md 仍为 Obsidian 版）
- 空列表文案：`没有找到 settings 文件`
- 安全闸：文件页只读 `memory` 或 `settings` 里有的路径，否则显示"读不到这个文件"
- 渲染函数 `Band`/`Pane` 保持纯函数；状态写入前比较，没变就不写
- 新 atom 的 shape 为 `'settings-1'`；`ui` 的 shape 不变
- 每个任务结束时：`claude plugin test .` 全部通过，`npx -y -p typescript@5.6.3 tsc -p . --noEmit` 没有输出，`claude plugin validate .` 显示 `✔ Validation passed`

## Review Focus

1. 会话工作目录就是 HOME：项目级路径和用户级相同，只列一次，标为 `用户级`（测试在 Task 1）
2. 列出后文件被删除：点 `查看` 显示 `读不到这个文件：…`，不会崩溃（测试在 Task 2）
3. `ui.filePath` 是旧值，已不在任何列表里（比如切换了项目）：文件页拒绝读取（测试在 Task 2）
4. settings 文件内容为空或不是合法 JSON：分别显示 `这个文件是空的`、原文代码块，不解析也不报错（测试在 Task 2）
5. `fs.exists` 抛错：保留上次存储的列表，不清空（测试在 Task 1）

## 测试脚手架（各任务共用）

测试文件放在 `tests/` 下。凡是挂载 UI 的测试，都必须 mock 以下调用，否则渲染 hook 会报错并回退给引擎：
`on('clock.now', () => ({ value: 1795000000000 }))`、`on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/h' : undefined }))`、`on('session.root', () => ({ value: '/p' }))`；
按需 mock `fs.exists`（`{ value: boolean }`）、`fs.read`（`{ value: string }`）、`process.run`（`{ value: { exitCode, stdout, stderr } }`）、`ui.toast`、`ui.open`（`{ value: { isPlaced: true } }`）。
渲染失败时 `ui.log` 会收到错误：调试时 hook 一下 `ui.log` 打印出来即可。
面板挂载参数：`{ plugin: 'code-hud', component: 'Pane', requestId: 'code-hud', surface: 'desktop', props: { title: 'Code HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } }`。

---

### Task 1: settings 文件的收集与存储

**Files:**
- Modify: `types/index.d.ts`（`View` 加 `'settings'`；新增类型；`PluginState['code-hud']` 加 `settings`）
- Create: `hooks/settings.ts`
- Modify: `hooks/state.ts`（新 atom 和读写函数；`readCounts` 加 `settings`）
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces:
  - `types/index.d.ts`: `export type SettingsLevel = 'user' | 'project' | 'local'`、`export type SettingsFile = { path: string; level: SettingsLevel }`、`PluginState['code-hud'].settings: Shaped<SettingsFile[]>`
  - `hooks/settings.ts`: `settingsCandidates(home: string, root: string): SettingsFile[]`（纯函数，按 user/project/local 顺序给出三个候选，按 path 去重并保留先出现的）；`collectSettings($: EngineInterface): Promise<SettingsFile[] | undefined>`（HOME 或 root 读不到、或任一 `fs.exists` 抛错时返回 `undefined`）
  - `hooks/state.ts`: `settings` atom（`{ plugin: 'code-hud', key: 'settings' }`，初始值 `[]`，shape `'settings-1'`）、`setSettings($, value: SettingsFile[]): Promise<void>`、`readSettings($): Promise<SettingsFile[]>`；`readCounts` 的返回类型变为 `{ memory; servers; hooks; settings: number }`

- [ ] **Step 1: 写失败的测试** `tests/settings.test.ts`：
  - `settingsCandidates('/h', '/p')` 等于 `[{ path: '/h/.claude/settings.json', level: 'user' }, { path: '/p/.claude/settings.json', level: 'project' }, { path: '/p/.claude/settings.local.json', level: 'local' }]`
  - `settingsCandidates('/h', '/h')` 的长度为 2，第一项为 `{ path: '/h/.claude/settings.json', level: 'user' }`，第二项的 level 为 `'local'`（Review Focus 1）
  - `collectSettings`：mock `fs.exists`，只有 `/h/.claude/settings.json` 和 `/p/.claude/settings.local.json` 为 true，结果是这两项，level 分别为 `user`、`local`
  - `collectSettings`：mock `fs.exists` 抛错，结果为 `undefined`（Review Focus 5）
- [ ] **Step 2: 运行** `claude plugin test .`，预期：FAIL（`hooks/settings` 模块不存在）
- [ ] **Step 3: 实现** 类型、`hooks/settings.ts`、`state.ts` 中的 atom 和读写函数。`collectSettings` 先拿 HOME（`$.env.get('HOME')`）和 `$.session.root()`，再对每个候选调用 `$.fs.exists`，用 `Promise.all` 并发，过滤出存在的。`setSettings` 照 `setMemory` 的写法（先比较再写）。
- [ ] **Step 4: 运行** `claude plugin test .` 预期 PASS；`tsc` 没有输出（`readCounts` 的调用方此时仍能编译，因为只是多了一个字段）

---

### Task 2: 面板的 settings 标签与文件页

**Files:**
- Modify: `hooks/pane.tsx`
- Modify: `hooks/register.tsx`（Pane 渲染 hook、按钮处理、`refreshSettings`、`pressTab`）
- Test: `tests/pane-settings.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `SettingsFile`、`readSettings`、`setSettings`、`collectSettings`；现有的 `openFile`、`setView`、`openWarp($, dir)`（`hooks/launch.ts`，对文件路径同样适用）
- Produces:
  - `PaneData` 新增 `settings: SettingsFile[]`
  - `PaneHandlers` 新增 `onSeeSettings(index: number): void`、`onWarpFile(index: number): void`、`onFileWarp(): void`；`onFileBack()` 保持签名，由 register 决定返回到哪个视图
  - register 内的 `refreshSettings($): Promise<void>`（`collectSettings` 返回 `undefined` 时不写）；`refreshFor($, view: View): Promise<void>`：hooks → `refreshHooks`，settings → `refreshSettings`，其他 → `refreshSession`。`pressTab` 和 `pressView` 都改用它
  - `fileKind(path: string | undefined, memory: MemoryFile[], settings: SettingsFile[]): 'claudemd' | 'settings' | undefined`，放在 `hooks/settings.ts`，由 Pane 和 register 共用

- [ ] **Step 1: 写失败的测试** `tests/pane-settings.test.tsx`（脚手架见上文；`fs.exists` 对 `/h/.claude/settings.json`、`/p/.claude/settings.json` 返回 true，其余 false；`fs.read` 按路径返回内容）：
  - `settings tab lists existing files`：按下 `tab-settings` 后，`find({ key: 'tab-settings' })` 的文字为 `settings.json 2`；`findAll({ type: 'Text', text: /settings(\.local)?\.json$/ })` 依次是 `~/.claude/settings.json`、`./.claude/settings.json`；存在 key 为 `set-see-0`、`set-warp-0`、`set-see-1`、`set-warp-1` 的按钮，不存在 `set-see-2`
  - `view shows json as code with a Warp button`：`fs.read` 返回 `'{"a":1}'`；依次按 `tab-settings`、`set-see-0` 后，`find({ type: 'Code' })` 的 `props.source` 为 `'{"a":1}'`、`props.language` 为 `'json'`；存在 key 为 `file-warp` 的按钮，不存在 `file-obsidian`
  - `back returns to settings tab`：在上一条的状态下按 `back`，再按 key 为 `tab-settings` 的按钮时它是 primary（`props.variant === 'primary'`），并且又能找到 `set-see-0`
  - `warp opens the file`：mock `process.run` 记录 argv 并返回 `{ exitCode: 0, stdout: '', stderr: '' }`；按 `set-warp-1` 后，记录到的 argv 为 `['open', '-a', 'Warp', '/p/.claude/settings.json']`；`file-warp` 同理打开当前文件
  - `deleted file reads as unreadable`：`fs.read` 对该路径抛错；按 `set-see-0` 后出现文字 `读不到这个文件：~/.claude/settings.json`（Review Focus 2）
  - `empty and invalid json`：`fs.read` 返回 `''` 时出现 `这个文件是空的`；返回 `'{oops'` 时 Code 的 source 为 `'{oops'`（Review Focus 4）
  - `stale path is refused`：按 `tab-settings`、`set-see-1` 停在 `/p/.claude/settings.json` 的文件页；然后让 `fs.exists` 对它改为返回 false，并触发一轮主对话结束（用测试 `$` 发出 `turn.complete` 事件，reason 为 `'answer'`，不带 agentId；需要 mock `session.surfaces` 返回 `['desktop']`）。之后页面显示 `读不到这个文件：./.claude/settings.json`，并且 `fs.read` 的 mock 对该路径的调用次数不再增加（Review Focus 3）
  - `claudemd file view keeps Obsidian`：已有行为的回归测试：mock `session.usage` 返回一个 memory 文件，查看后存在 `file-obsidian`，按 `back` 回到 `tab-claudemd`（primary）
- [ ] **Step 2: 运行** `claude plugin test .`，预期：FAIL（找不到 `tab-settings`）
- [ ] **Step 3: 实现 `Pane`**：tabs 在 hooks 之后加 `tab('settings', …)`；新增 `settingsView()`，按 Global Constraints 的标签、颜色、文案生成行，结构照抄 `memoryView`（`item([pill, <Text mono>{displayPath}</Text>], [查看, Warp])`）；文件页用 `fileKind` 决定内容（settings 用 `<Code language="json">`，其余用 Markdown）、外部按钮（`file-warp`/`Warp` 或 `file-obsidian`/`Obsidian`）和超长提示语；`body` 的分发里加上 settings。
- [ ] **Step 4: 实现 register**：Pane 渲染 hook 多读 `readSettings`；安全闸改为 `fileKind(ui.filePath, memory, settings) === undefined` 时拒绝；接上三个新回调（`onSeeSettings` → `openFile(settings[i].path)`，`onWarpFile`/`onFileWarp` → `pressLaunch($, () => openWarp($, path))`）；`onFileBack` → `setView($, fileKind(...) === 'settings' ? 'settings' : 'claudemd')`；`pressTab` 改用 `refreshFor`；`start()` 加 `background($, refreshSettings($))`；`onTurnEnd` 的刷新里加 `refreshSettings`。
- [ ] **Step 5: 运行** `claude plugin test .` 预期全部 PASS；`tsc` 没有输出

---

### Task 3: 状态条按钮、宽度与窄条计数

**Files:**
- Modify: `hooks/band.tsx`
- Modify: `hooks/pane.tsx`（只改 widget 分支）
- Modify: `hooks/register.tsx`（只改 `pressView`，让它走 `refreshFor`）
- Test: `tests/band-settings.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `readCounts`（含 `settings`）；Task 2 的 `refreshFor`
- Produces: `BandData.counts` 增加 `settings: number`；`SEGMENT_WIDTH.counts` 从 `40` 改为 `56`（第二行合计 76）

- [ ] **Step 1: 写失败的测试** `tests/band-settings.test.tsx`：
  - `visibleSegments(76)` 同时包含 `counts` 和 `launch`；`visibleSegments(75)` 包含 `counts`、不包含 `launch`
  - 挂载 AbovePrompt（`{ plugin: 'code-hud', component: 'AbovePrompt', surface: 'desktop', props: { hasSurvey: false, isWorking: false, bodyColumns: 120 } }`，缺的 props 按类型补齐），`fs.exists` 让两个 settings 文件存在，先跑一次 `$.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })` 让模组启动；`findAll({ type: 'Button' })` 的 key 顺序里 `band-settings` 紧跟在 `band-hooks` 后面，文字为 `settings.json 2`
  - 按 `band-settings` 后，mock 的 `ui.open` 收到 `{ id: 'code-hud' }`，再挂载 Pane 时 `tab-settings` 为 primary
  - 挂载 Pane 并设 `placement: 'widget'` 时，出现文字 `CLAUDE.md 0 · MCP 0 · hooks 0 · settings.json 2`
- [ ] **Step 2: 运行** `claude plugin test .`，预期：FAIL（找不到 `band-settings`，并且 `visibleSegments(75)` 仍包含 launch）
- [ ] **Step 3: 实现**：`band.tsx` 在 `band-hooks` 之后加 `action('band-settings', 'primary', () => handlers.onView('settings'), \`settings.json ${counts.settings}\`)`，`SEGMENT_WIDTH.counts = 56`，把文件头注释里的 "row 2: 60" 改为 76；widget 文案末尾加 ` · settings.json ${settings.length}`；`pressView` 末尾的刷新改为 `background($, refreshFor($, view))`。
- [ ] **Step 4: 运行** `claude plugin test .` 全部 PASS；`tsc` 没有输出；`claude plugin validate .` 显示 `✔ Validation passed`

---

### 收尾：人工验收

- [ ] 模组位于 `~/.claude/mods/`，改动在**下次启动会话**时加载（或按引擎提示重载）。在桌面版 Code 标签页打开一个有 `.claude/settings.json` 的项目，确认：第二行出现 `settings.json N`；点开后的列表、`查看`、`Warp`、`返回` 都符合设计；窄窗口下 Warp/Obsidian 两个启动按钮先被收起
