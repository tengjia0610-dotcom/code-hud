import type { Elements, RenderElement } from 'claude-code'
import type { Dynamic, HookGroup, McpServer, MemoryFile, Ui, View } from '../types'
import { COLORS, formatPercent, formatResetClock, formatTokens, gaugeColor, shortPath } from './format'
import { cardSvg, chipSvg, type ChipPart } from './svg'

export type PaneData = {
  dynamic: Dynamic
  memory: MemoryFile[]
  servers: McpServer[]
  hooks: HookGroup[]
  ui: Ui
  placement: string
  home: string
  cwd: string
  hookCommand?: string | false   // false: the open hook is not a command
  fileText?: string
  fileError?: string
  now: number
}

export type PaneHandlers = {
  onTab(view: View): void
  onSee(index: number): void
  onObsidianFile(index: number): void
  onServer(id: string): void
  onBack(): void
  onFileBack(): void
  onRefresh(): void
  onFileObsidian(): void
  onGroup(id: string): void
  onHook(group: string, index: number): void
}

const PATH_LIMIT = 48
const DESCRIPTION_LIMIT = 120
// Free text a list draws (a server's what, a group's description, a hook's matcher, condition, what and name label).
const TEXT_LIMIT = 160
const FILE_LIMIT = 60000
const HOOKS_NOTE = '仅统计能从配置文件发现的 hooks。应用内置的不在其中，被插件自身开关禁用的仍会计入。'
// Draw caps: past the engine's tree limit the whole pane is refused, so no list draws more rows than these
// (a row costs about 1.2-1.4k characters of tree, a tool about 0.5k). Hook rows count across all open groups.
export const MEMORY_CAP = 60
export const SERVER_CAP = 60
export const TOOL_CAP = 150
export const HOOK_CAP = 60
// A second stop for hook rows: the summed free text (matcher + condition + what + name label, after the 160 cut) of the
// drawn rows, each field measured as its JSON length. Today's 57 hooks hold about 3.4k; 60 rows holding 14k measure about 94k of tree.
export const HOOK_TEXT_BUDGET = 14000

const MEMORY_PILL: Record<string, { label: string; color: string }> = {
  User: { label: 'User', color: COLORS.blue },
  Project: { label: 'Project', color: COLORS.green },
  Local: { label: 'Local', color: COLORS.green },
  AutoMem: { label: '自动记忆', color: COLORS.purple },
}

/** A display path cut in the middle with `…` past PATH_LIMIT characters, the file name kept. */
function displayPath(path: string, home: string, cwd: string): string {
  const short = shortPath(path, home, cwd)
  if (short.length <= PATH_LIMIT) return short
  const name = short.slice(short.lastIndexOf('/'))
  if (name.length >= PATH_LIMIT - 1) return '…' + name.slice(-(PATH_LIMIT - 1))
  return short.slice(0, PATH_LIMIT - 1 - name.length) + '…' + name
}

/** Text a Markdown, Code or Text may hold: line ends made `\n`, every other control character but tab dropped. */
function sanitize(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
}

/** Free text cut at TEXT_LIMIT characters with `…`, so no one row can take a list past the tree's limit. */
function clip(text: string): string {
  const chars = [...sanitize(text)]
  return chars.length > TEXT_LIMIT ? chars.slice(0, TEXT_LIMIT - 1).join('') + '…' : chars.join('')
}

/** The text cut at FILE_LIMIT characters, never ending on half of a surrogate pair. */
function cutFile(text: string): string {
  const cut = text.slice(0, FILE_LIMIT)
  const last = cut.charCodeAt(cut.length - 1)
  return text.length > FILE_LIMIT && last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

/** The first sentence (or line) of a description, cut at DESCRIPTION_LIMIT characters. */
function firstSentence(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  const end = line.search(/[.!?](\s|$)|[。！？]/)
  const sentence = end === -1 ? line : line.slice(0, end + 1)
  const chars = [...sentence]
  return chars.length > DESCRIPTION_LIMIT ? chars.slice(0, DESCRIPTION_LIMIT - 1).join('') + '…' : sentence
}

/** The band's "HH:MM 重置", led by "M月D日" when the reset is not today; undefined without a future reset. */
function resetOn(at: string | undefined, now: number): string | undefined {
  const clock = formatResetClock(at, now)
  if (at === undefined || clock === undefined) return clock
  const d = new Date(Date.parse(at))
  return d.toDateString() === new Date(now).toDateString() ? clock : `${d.getMonth() + 1}月${d.getDate()}日 ${clock}`
}

/** Pure tree builder: no `$`, no awaits. */
export function Pane(el: Elements['desktop'], data: PaneData, handlers: PaneHandlers): RenderElement {
  const { Box, Text, Button, Svg, Code, Markdown } = el
  const { dynamic, memory, servers, hooks, ui } = data
  const hookCount = hooks.reduce((sum, group) => sum + group.rows.length, 0)

  const pill = (text: string, color: string): RenderElement => {
    const { source, width, height } = chipSvg([{ text }], color)
    return <Svg source={source} width={width} height={height} alt={text} />
  }
  const card = (label: string, percent: number, sub?: string): RenderElement => {
    const value = formatPercent(percent)
    const { source, width, height } = cardSvg({ label, value, sub, ring: percent, color: gaugeColor(percent) })
    return <Svg source={source} width={width} height={height} alt={`${label} ${value}${sub === undefined ? '' : ` · ${sub}`}`} />
  }
  // A plain secondary Button with a string label: a desktop Button ignores a Text child's colour.
  const action = (key: string, onPress: () => void, text: string): RenderElement => (
    <Button key={key} variant="secondary" onPress={onPress}>{text}</Button>
  )
  const row = (children: RenderElement[], gap = 1): RenderElement => (
    <Box flexDirection="row" alignItems="center" gap={gap} flexWrap="wrap">{children}</Box>
  )
  const item = (first: RenderElement[], second: RenderElement[]): RenderElement => (
    <Box flexDirection="column" rowGap="xs">{row(first)}{row(second)}</Box>
  )
  const dim = (text: string): RenderElement => <Text dimColor>{text}</Text>
  const list = (items: RenderElement[]): RenderElement => <Box flexDirection="column" rowGap="sm">{items}</Box>
  const hidden = (n: number): RenderElement[] => (n > 0 ? [dim(`另有 ${n} 项未显示`)] : [])

  // ---- widget: the context gauge and the three counts ----
  if (data.placement === 'widget') {
    const parts: ChipPart[] = [
      { ring: dynamic.contextPercent },
      { text: '上下文', color: COLORS.gray, weight: 400 },
      { text: formatPercent(dynamic.contextPercent), color: gaugeColor(dynamic.contextPercent), weight: 600 },
    ]
    const { source, width, height } = chipSvg(parts, COLORS.gray)
    return row([
      <Svg source={source} width={width} height={height} alt={`上下文 ${formatPercent(dynamic.contextPercent)}`} />,
      <Text color={COLORS.gray}>{`CLAUDE.md ${memory.length} · MCP ${servers.length} · hooks ${hookCount}`}</Text>,
    ])
  }

  // ---- file view: one CLAUDE.md as Markdown, no cards, no tabs ----
  if (ui.view === 'file') {
    const shown = displayPath(ui.filePath ?? '', data.home, data.cwd)
    const text = sanitize(data.fileText ?? '')
    const body = data.fileText === undefined
      ? dim(`读不到这个文件：${shown}`)
      : text === ''
        ? dim('这个文件是空的')
        : <Box flexDirection="column" rowGap="sm">
          {[<Markdown text={cutFile(text)} />, ...(text.length > FILE_LIMIT ? [dim('文件较长，其余部分请在 Obsidian 里查看')] : [])]}
        </Box>
    return (
      <Box flexDirection="column" rowGap="md">
        {[
          row([
            action('back', () => handlers.onFileBack(), '返回'),
            action('refresh', () => handlers.onRefresh(), '刷新'),
            <Text mono>{shown}</Text>,
            action('file-obsidian', () => handlers.onFileObsidian(), 'Obsidian'),
          ]),
          body,
        ]}
      </Box>
    )
  }

  // ---- metric cards: only those with a reading ----
  const cards: RenderElement[] = []
  if (dynamic.contextPercent !== undefined) {
    const sub = dynamic.contextTokens !== undefined && dynamic.contextWindow !== undefined
      ? `${formatTokens(dynamic.contextTokens)} / ${formatTokens(dynamic.contextWindow)}`
      : undefined
    cards.push(card('上下文', dynamic.contextPercent, sub))
  }
  if (dynamic.usagePercent !== undefined) cards.push(card('5 小时用量', dynamic.usagePercent, formatResetClock(dynamic.usageResetsAt, data.now)))
  if (dynamic.weekPercent !== undefined) cards.push(card('7 天用量', dynamic.weekPercent, resetOn(dynamic.weekResetsAt, data.now)))

  // ---- tabs: the current one primary with its plain label ----
  const view: View = ui.view
  const tab = (key: View, text: string): RenderElement => (key === view
    ? <Button key={`tab-${key}`} variant="primary" onPress={() => handlers.onTab(key)}>{text}</Button>
    : action(`tab-${key}`, () => handlers.onTab(key), text))
  const tabs = row([
    tab('claudemd', `CLAUDE.md ${memory.length}`),
    tab('mcp', `MCP ${servers.length}`),
    tab('hooks', `hooks ${hookCount}`),
  ])

  // ---- CLAUDE.md ----
  const memoryView = (): RenderElement => {
    if (memory.length === 0) return dim('这个会话没有加载任何 CLAUDE.md')
    return list([...memory.slice(0, MEMORY_CAP).map((file, i) => {
      const type = MEMORY_PILL[file.type] ?? { label: file.type, color: COLORS.gray }
      return item(
        [pill(type.label, type.color), <Text mono>{displayPath(file.path, data.home, data.cwd)}</Text>],
        [
          dim(`${formatTokens(file.tokens)} tok`),
          action(`see-${i}`, () => handlers.onSee(i), '查看'),
          action(`obs-${i}`, () => handlers.onObsidianFile(i), 'Obsidian'),
        ],
      )
    }), ...hidden(memory.length - MEMORY_CAP)])
  }

  // ---- MCP ----
  const serverHead = (server: McpServer): RenderElement[] => {
    const head = [<Text weight="semibold">{server.name}</Text>]
    if (server.plugin !== undefined) head.push(pill(`插件 ${server.plugin}`, COLORS.gray))
    return head
  }
  const mcpView = (): RenderElement => {
    const open = servers.find(s => s.id === ui.serverId)
    if (open !== undefined) {
      return (
        <Box flexDirection="column" rowGap="sm">
          {row([action('back', () => handlers.onBack(), '返回'), ...serverHead(open)])}
          {list([...open.tools.slice(0, TOOL_CAP).map(tool => {
            const second: RenderElement[] = []
            if (tool.description !== undefined) second.push(dim(firstSentence(sanitize(tool.description))))
            if (!tool.isLoaded) second.push(dim('未加载'))
            // One Box per tool, the name a bare Text: 150 tools must stay well inside the tree's budget.
            const name = <Text mono>{sanitize(tool.name)}</Text>
            return second.length === 0 ? name : <Box flexDirection="column" rowGap="xs">{[name, row(second)]}</Box>
          }), ...hidden(open.tools.length - TOOL_CAP)])}
        </Box>
      )
    }
    if (servers.length === 0) return dim('这个会话没有连接任何 MCP 服务')
    return list([...servers.slice(0, SERVER_CAP).map((server, i) => item(
      serverHead(server),
      [
        dim(clip(server.what)),
        action(`srv-${i}`, () => handlers.onServer(server.id), `${server.tools.length} 工具`),
        dim(`${formatTokens(server.tokens)} tok`),
      ],
    )), ...hidden(servers.length - SERVER_CAP)])
  }

  // ---- hooks ----
  const hookRows = (group: HookGroup, count: number): RenderElement[] => group.rows.slice(0, count).map(hook => {
    const first: RenderElement[] = [pill(hook.event, COLORS.purple)]
    if (hook.matcher !== undefined) first.push(<Text mono>{clip(hook.matcher)}</Text>)
    if (hook.condition !== undefined) first.push(<Text mono dimColor>{clip(hook.condition)}</Text>)
    first.push(action(`hook-${group.id}-${hook.index}`, () => handlers.onHook(group.id, hook.index), clip(hook.name)))
    const line = item(first, [dim(clip(hook.what))])
    if (ui.openHook?.group !== group.id || ui.openHook.index !== hook.index) return line
    const command = data.hookCommand === false
      ? dim('这条 hook 不是命令类型')
      : data.hookCommand === undefined ? dim('读不到这条 hook 的命令') : <Code source={sanitize(data.hookCommand)} language="sh" />
    return <Box flexDirection="column" rowGap="xs">{[line, command]}</Box>
  })
  const hooksView = (): RenderElement => {
    if (hooks.length === 0) return dim('没有发现任何 hooks')
    // Rows across the open groups, in order, until HOOK_CAP rows or HOOK_TEXT_BUDGET characters of free text;
    // a group whose rows are cut still shows its head.
    let budget = HOOK_CAP
    let text = HOOK_TEXT_BUDGET
    let cut = 0
    const textOf = (hook: HookGroup['rows'][number]): number =>
      // Measured as the tree measures it: a quote or a backslash costs two, as JSON escapes it.
      [hook.matcher ?? '', hook.condition ?? '', hook.what, hook.name].reduce((n, t) => n + JSON.stringify(clip(t)).length - 2, 0)
    const groups = hooks.map(group => {
      const isOpen = ui.openGroups.includes(group.id)
      const head = [
        row([dim(isOpen ? '▾' : '▸'), action(`grp-${group.id}`, () => handlers.onGroup(group.id), `${group.label} (${group.rows.length})`)]),
      ]
      if (group.description !== undefined) head.push(dim(clip(group.description)))
      let count = 0
      if (isOpen) {
        while (count < group.rows.length && budget > 0 && textOf(group.rows[count]!) <= text) {
          text -= textOf(group.rows[count]!)
          budget -= 1
          count += 1
        }
        if (count < group.rows.length) budget = 0   // a stop is a stop: later groups draw no rows either
        cut += group.rows.length - count
      }
      return <Box flexDirection="column" rowGap="xs">{[...head, ...hookRows(group, count)]}</Box>
    })
    return list([...groups, ...hidden(cut), dim(HOOKS_NOTE)])
  }

  const body = view === 'mcp' ? mcpView() : view === 'hooks' ? hooksView() : memoryView()
  const top = cards.length === 0 ? [] : [row(cards)]
  return <Box flexDirection="column" rowGap="md">{[...top, tabs, body]}</Box>
}
