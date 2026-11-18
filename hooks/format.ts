export const COLORS = {
  blue: '#378ADD', purple: '#7F77DD', green: '#1D9E75', amber: '#D08A1E',
  red: '#E24B4A', gray: '#8A8A8A', clay: '#D97757',
}

export const tint = (color: string): string => color + '2E'

const trim1 = (n: number): string => String(Math.round(n * 10) / 10)

export function formatTokens(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—'
  if (n >= 1_000_000) return trim1(n / 1_000_000) + 'M'
  if (n >= 1_000) return trim1(n / 1_000) + 'k'
  return String(Math.round(n))
}

export function formatPercent(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—'
  return Math.round(Math.max(0, n)) + '%'
}

export function formatResetClock(resetsAt: string | undefined, now: number): string | undefined {
  if (!resetsAt) return undefined
  const t = Date.parse(resetsAt)
  if (Number.isNaN(t) || t <= now) return undefined
  const d = new Date(t)
  const two = (v: number): string => String(v).padStart(2, '0')
  return two(d.getHours()) + ':' + two(d.getMinutes()) + ' 重置'
}

export function shortPath(path: string, home: string, cwd: string): string {
  if (cwd && path.startsWith(cwd + '/')) return '.' + path.slice(cwd.length)
  if (home && path.startsWith(home + '/')) return '~' + path.slice(home.length)
  return path
}

const MODES: Record<string, { label: string; color: string }> = {
  default: { label: '手动', color: COLORS.gray },
  acceptEdits: { label: '自动接受编辑', color: COLORS.blue },
  plan: { label: '计划', color: COLORS.purple },
  auto: { label: '自动', color: COLORS.green },
  bypassPermissions: { label: '跳过权限', color: COLORS.red },
  dontAsk: { label: '不询问', color: COLORS.amber },
}

export function modeLabel(mode: string | null): string {
  if (mode === null) return '—'
  return (Object.hasOwn(MODES, mode) && MODES[mode]?.label) || mode
}

export function modeColor(mode: string | null): string {
  return (mode !== null && Object.hasOwn(MODES, mode) && MODES[mode]?.color) || COLORS.gray
}

export function gaugeColor(percent: number | undefined): string {
  if (percent === undefined || Number.isNaN(percent)) return COLORS.gray
  if (percent < 60) return COLORS.green
  if (percent <= 85) return COLORS.amber
  return COLORS.red
}

export function modelLabel(id: string | undefined): string {
  if (!id) return '—'
  const m = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?(\[1m\])?$/.exec(id)
  const [, family, major, minor, oneM] = m ?? []
  if (!family || !major || !minor) return id
  return family.charAt(0).toUpperCase() + family.slice(1) + ' ' + major + '.' + minor + (oneM ? ' 1M' : '')
}
