import type { Elements, RenderElement } from 'claude-code'
import type { Dynamic, ModeState, View } from '../types'
import { COLORS, formatPercent, formatResetClock, gaugeColor, modeColor, modeLabel, modelLabel } from './format'
import type { Pose } from './mascot'
import { chipSvg, mascotSvg, type ChipPart } from './svg'

export type Segment = 'reset' | 'mascot' | 'model' | 'usage' | 'launch' | 'mode' | 'project' | 'counts' | 'context'

/** What goes first when a row does not fit. `counts` and `context` are never dropped. */
export const DROP_ORDER: Segment[] = ['reset', 'mascot', 'model', 'usage', 'launch', 'mode', 'project']

/** Estimated width of each segment, in character cells (row 1: 92, row 2: 76). */
export const SEGMENT_WIDTH: Record<Segment, number> = {
  model: 14, project: 28, context: 12, usage: 10, reset: 12, mode: 12, counts: 56, launch: 20, mascot: 4,
}

/** The two rows as the band lays them out: status segments and the mascot, then counts and launch. */
const ROWS: Segment[][] = [['model', 'project', 'context', 'usage', 'reset', 'mode', 'mascot'], ['counts', 'launch']]

/** Each row must fit in `columns`: segments of a row that does not fit drop in DROP_ORDER until it does. */
export function visibleSegments(columns: number): Set<Segment> {
  const shown = new Set(Object.keys(SEGMENT_WIDTH) as Segment[])
  const width = (row: Segment[]): number => row.filter(s => shown.has(s)).reduce((sum, s) => sum + SEGMENT_WIDTH[s], 0)
  for (const segment of DROP_ORDER) {
    const row = ROWS.find(r => r.includes(segment)) ?? []
    if (!(width(row) <= columns)) shown.delete(segment)
  }
  return shown
}

export type BandData = {
  dynamic: Dynamic
  mode: ModeState | null
  counts: { memory: number; servers: number; hooks: number; settings: number }
  pose: Pose
  columns: number
  now: number
}

export type BandHandlers = { onView(view: View): void; onWarp(): void; onObsidian(): void }

const POSE_ALT: Record<Pose, string> = {
  idle: '待机', working: '工作中', thinking: '思考中', happy: '开心', error: '出错了', waiting: '等你', sleeping: '睡着了',
}

// The art leaves a margin inside its grid, so the box is larger than the two rows to read as spanning them.
const MASCOT_SIZE = 56
const ROW_GAP = 'xs'
// Project and branch names longer than this are cut to fit a chip: the first LIMIT - 1 characters and `…`.
const NAME_LIMIT = 28

const truncate = (text: string): string => {
  const chars = [...text]
  return chars.length > NAME_LIMIT ? chars.slice(0, NAME_LIMIT - 1).join('') + '…' : text
}

/** Pure tree builder: no `$`, no awaits. */
export function Band(el: Elements['desktop'], data: BandData, handlers: BandHandlers): RenderElement {
  const { Box, Button, Svg } = el
  const { dynamic, mode, counts } = data
  const shown = visibleSegments(data.columns)

  // A chip is an image (chipSvg owns its look); `alt` is its plain text.
  const chip = (parts: ChipPart[], color: string, alt: string): RenderElement => {
    const { source, width, height } = chipSvg(parts, color)
    return <Svg source={source} width={width} height={height} alt={alt} />
  }
  const pill = (text: string, color: string, alt = text): RenderElement => chip([{ text }], color, alt)
  const gauge = (label: string, percent: number | undefined, reset?: string): RenderElement => {
    const parts: ChipPart[] = [
      { ring: percent },
      { text: label, color: COLORS.gray, weight: 400 },
      { text: formatPercent(percent), color: gaugeColor(percent), weight: 600 },
    ]
    if (reset !== undefined) parts.push({ text: `· ${reset}`, color: COLORS.gray, weight: 400 })
    return chip(parts, COLORS.gray, `${label} ${formatPercent(percent)}${reset === undefined ? '' : ` · ${reset}`}`)
  }
  // A native Button with a plain string label: a desktop Button ignores a Text child's colour.
  const action = (key: string, variant: 'primary' | 'secondary', onPress: () => void, text: string): RenderElement => (
    <Button key={key} variant={variant} onPress={onPress}>{text}</Button>
  )
  const row = (children: RenderElement[], gap = 1): RenderElement => (
    <Box flexDirection="row" alignItems="center" gap={gap} flexWrap="wrap">{children}</Box>
  )

  // ---- row 1: status ----
  const status: RenderElement[] = []

  if (shown.has('model') && dynamic.model !== undefined) status.push(pill(modelLabel(dynamic.model), COLORS.gray))

  if (shown.has('project')) {
    if (dynamic.project !== undefined) status.push(pill(truncate(dynamic.project), COLORS.blue, dynamic.project))
    if (dynamic.branch !== undefined) {
      const dirty = dynamic.isDirty ? '*' : ''
      status.push(pill(`⎇ ${truncate(dynamic.branch)}${dirty}`, COLORS.purple, `⎇ ${dynamic.branch}${dirty}`))
    }
  }

  if (shown.has('context')) status.push(gauge('上下文', dynamic.contextPercent))

  if (shown.has('usage') && dynamic.usagePercent !== undefined) {
    const reset = shown.has('reset') ? formatResetClock(dynamic.usageResetsAt, data.now) : undefined
    status.push(gauge('用量', dynamic.usagePercent, reset))
  }

  if (shown.has('mode') && mode !== null) {
    const text = modeLabel(mode.value) + (mode.isConfirmed ? '' : '?')
    status.push(pill(text, mode.isConfirmed ? modeColor(mode.value) : COLORS.gray))
  }

  // ---- row 2: actions (native desktop Buttons, bare) ----
  const actions: RenderElement[] = []

  if (shown.has('counts')) {
    actions.push(row([
      action('band-claudemd', 'primary', () => handlers.onView('claudemd'), `CLAUDE.md ${counts.memory}`),
      action('band-mcp', 'primary', () => handlers.onView('mcp'), `MCP ${counts.servers}`),
      action('band-hooks', 'primary', () => handlers.onView('hooks'), `hooks ${counts.hooks}`),
      action('band-settings', 'primary', () => handlers.onView('settings'), `settings.json ${counts.settings}`),
    ]))
  }

  if (shown.has('launch')) {
    actions.push(row([
      action('band-obsidian', 'secondary', () => handlers.onObsidian(), 'Obsidian'),
      action('band-warp', 'secondary', () => handlers.onWarp(), 'Warp'),
    ]))
  }

  const left = (
    <Box flexDirection="column" flexGrow={1} rowGap={ROW_GAP}>
      {row(status)}
      {row(actions, 3)}
    </Box>
  )
  if (!shown.has('mascot')) return <Box flexDirection="row" alignItems="center" gap={1}>{left}</Box>

  return (
    <Box flexDirection="row" alignItems="center" gap={1}>
      {left}
      <Svg source={mascotSvg(data.pose, MASCOT_SIZE)} width={MASCOT_SIZE} height={MASCOT_SIZE} alt={`小人：${POSE_ALT[data.pose]}`} />
    </Box>
  )
}
