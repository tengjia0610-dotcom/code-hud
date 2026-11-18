import type { EngineInterface } from 'claude-code'
import type { Dynamic, HookGroup, McpServer, MemoryFile } from '../types'
import { displayCommand, toRows, type RawHook } from './hook-name'
import { groupServers, parseServer } from './mcp'

// "A git call is running" flag: a second collectDynamic skips git while it is set. Cleared in `finally`.
let gitInFlight = false

const SOURCES = [
  ['user', '用户设置'], ['project', '项目设置'], ['local', '本地设置'], ['flag', '命令行设置'], ['policy', '策略设置'],
] as const

type Plugin = { name: string; dir: string }
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

async function debug($: EngineInterface, text: string): Promise<void> {
  try { await $.ui.log(text, { to: 'debug' }) } catch { /* logging must not fail a collection */ }
}

// Runs a read; a rejection is logged (debug) and answered with undefined.
async function attempt<T>($: EngineInterface, what: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (err) {
    await debug($, `code-hud: ${what} failed: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
}

async function runGit($: EngineInterface, cwd: string, argv: string[]): Promise<{ exitCode: number; stdout: string } | undefined> {
  try {
    const r = await $.process.run(argv, { cwd, timeoutMs: 2000 })
    return { exitCode: r.exitCode, stdout: r.stdout }
  } catch {
    return undefined
  }
}

async function gitFacts($: EngineInterface, cwd: string): Promise<Pick<Dynamic, 'branch' | 'isDirty'>> {
  const out: Pick<Dynamic, 'branch' | 'isDirty'> = {}
  const b = await runGit($, cwd, ['git', 'branch', '--show-current'])
  if (!b || b.exitCode !== 0) return out
  let branch = b.stdout.trim()
  if (!branch) {
    const h = await runGit($, cwd, ['git', 'rev-parse', '--short', 'HEAD'])
    if (h && h.exitCode === 0) branch = h.stdout.trim()
  }
  if (branch) out.branch = branch
  const s = await runGit($, cwd, ['git', '--no-optional-locks', 'status', '--porcelain'])
  if (!s) out.isDirty = false
  else if (s.exitCode === 0) out.isDirty = s.stdout.trim() !== ''
  return out
}

/** What a collection obtained; `cleared` names stored keys to remove (usage answered without a context reading). */
export type Collected = Partial<Dynamic> & { cleared?: (keyof Dynamic)[] }

export async function collectDynamic($: EngineInterface): Promise<Collected> {
  const out: Collected = {}
  const runGitNow = !gitInFlight
  if (runGitNow) gitInFlight = true
  try {
    const model = await attempt($, 'session.model', () => $.session.model())
    if (model) out.model = model
    const repo = await attempt($, 'session.repo', () => $.session.repo())
    const root = repo?.root ?? await attempt($, 'session.root', () => $.session.root())
    const project = root?.split('/').filter(Boolean).pop()
    if (project) out.project = project
    const usage = await attempt($, 'session.usage', () => $.session.usage())
    if (usage) {
      const c = usage.context
      if (typeof c.percent === 'number') out.contextPercent = c.percent
      else out.cleared = ['contextPercent', 'contextTokens']   // a fresh or just compacted window: no reading yet
      if (typeof c.tokens === 'number') out.contextTokens = c.tokens
      if (typeof c.window === 'number') out.contextWindow = c.window
      const five = usage.rateLimits.find(r => r.kind === 'five_hour')
      if (five) { out.usagePercent = five.percentUsed; if (five.resetsAt) out.usageResetsAt = five.resetsAt }
      const week = usage.rateLimits.find(r => r.kind === 'seven_day')
      if (week) { out.weekPercent = week.percentUsed; if (week.resetsAt) out.weekResetsAt = week.resetsAt }
    }
    if (runGitNow && repo) Object.assign(out, await gitFacts($, repo.root))
  } catch (err) {
    await debug($, `code-hud: collectDynamic failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    if (runGitNow) gitInFlight = false
  }
  return out
}

// A parse error is logged by path only: the parser's message can quote a fragment of the text (a command).
async function readJson($: EngineInterface, path: string, what: string): Promise<unknown> {
  const text = await attempt($, `${what} ${path}`, () => $.fs.read(path))
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    await debug($, `code-hud: invalid JSON in ${path}`)
    return undefined
  }
}

async function manifest($: EngineInterface, dir: string): Promise<Obj | undefined> {
  const m = await readJson($, `${dir}/.claude-plugin/plugin.json`, 'read manifest')
  return isObj(m) ? m : undefined
}

export async function discoverPlugins($: EngineInterface): Promise<Plugin[]> {
  const found: Plugin[] = []
  const home = await attempt($, 'env HOME', () => $.env.get('HOME'))
  if (home) {
    // (a) installed plugins
    const enabled = await attempt($, 'settings enabledPlugins', () => $.settings.read({ key: 'enabledPlugins' }))
    const installed = await readJson($, `${home}/.claude/plugins/installed_plugins.json`, 'read')
    const plugins = isObj(installed) && isObj(installed.plugins) ? installed.plugins : {}
    for (const [key, entries] of Object.entries(plugins)) {
      if (isObj(enabled) && enabled[key] === false) continue
      const first = Array.isArray(entries) ? entries[0] : undefined
      const dir = isObj(first) ? first.installPath : undefined
      const at = key.indexOf('@')
      const name = at < 0 ? key : key.slice(0, at)
      if (typeof dir === 'string' && dir && name) found.push({ name, dir })
    }
    // (b) synced: synced/<account>/<plugin id>/
    const root = `${home}/.claude/plugins/synced`
    const accounts = await attempt($, `list ${root}`, () => $.fs.list(root))
    for (const a of accounts ?? []) {
      if (a.kind !== 'dir') continue
      const ids = await attempt($, `list ${root}/${a.name}`, () => $.fs.list(`${root}/${a.name}`))
      for (const p of ids ?? []) {
        if (p.kind !== 'dir') continue
        const dir = `${root}/${a.name}/${p.name}`
        let text: string
        try { text = await $.fs.read(`${dir}/.claude-plugin/plugin.json`) } catch { continue }   // not a plugin directory
        try {
          const m: unknown = JSON.parse(text)
          if (isObj(m) && typeof m.name === 'string' && m.name) found.push({ name: m.name, dir })
        } catch {
          await debug($, `code-hud: invalid manifest in ${dir}`)
        }
      }
    }
  }
  // (c) CLAUDE_CODE_PLUGIN_DIRS
  const list = await attempt($, 'env CLAUDE_CODE_PLUGIN_DIRS', () => $.env.get('CLAUDE_CODE_PLUGIN_DIRS'))
  for (const raw of (list ?? '').split(':')) {
    if (!raw) continue
    const dir = raw === '~' || raw.startsWith('~/') ? `${home ?? ''}${raw.slice(1)}` : raw
    const m = await manifest($, dir)
    if (m && typeof m.name === 'string' && m.name) found.push({ name: m.name, dir })
  }
  const seen = new Set<string>()
  return found.filter(p => !seen.has(p.dir) && !!seen.add(p.dir))
}

/** Undefined when the breakdown could not be read: the caller keeps what it stored. */
export async function collectSession($: EngineInterface): Promise<{ memory: MemoryFile[]; servers: McpServer[] } | undefined> {
  const usage = await attempt($, 'session.usage breakdown', () => $.session.usage({ breakdown: 'summary' }))
  const breakdown = usage?.context.breakdown
  if (breakdown === undefined) return undefined
  const memory = breakdown.memoryFiles.map(f => ({ path: f.path, type: f.type, tokens: f.tokens }))
  const tools = breakdown.mcpTools
  if (tools.length === 0) return { memory, servers: [] }
  const infos = ((await attempt($, 'tool.list', () => $.tool.list())) ?? []).map(t => ({ name: t.name, description: t.description }))
  const pluginDescriptions: Record<string, string> = {}
  if (tools.some(t => parseServer(t.serverName).plugin !== undefined)) {
    for (const p of await discoverPlugins($)) {
      const m = await manifest($, p.dir)
      if (m && typeof m.description === 'string' && !Object.hasOwn(pluginDescriptions, p.name)) pluginDescriptions[p.name] = m.description
    }
  }
  return { memory, servers: groupServers(tools, infos, pluginDescriptions) }
}

// { [event]: { matcher?, hooks: { type?, command?, if? }[] }[] } -> RawHook[] in file order; undefined when the shape is wrong.
function flatten(hooks: unknown): RawHook[] | undefined {
  if (!isObj(hooks)) return undefined
  const out: RawHook[] = []
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) return undefined
    for (const g of groups) {
      if (!isObj(g) || !Array.isArray(g.hooks)) return undefined
      for (const h of g.hooks) {
        if (!isObj(h)) return undefined
        const raw: RawHook = { event }
        if (typeof g.matcher === 'string') raw.matcher = g.matcher
        if (typeof h.if === 'string') raw.if = h.if
        if (typeof h.type === 'string') raw.type = h.type
        if (typeof h.command === 'string') raw.command = h.command
        out.push(raw)
      }
    }
  }
  return out
}

/** A source that fails to read keeps its group from `previous` (if it had one), in place. */
export async function collectHooks($: EngineInterface, previous: HookGroup[] = []): Promise<HookGroup[]> {
  const groups: HookGroup[] = []
  const keep = (id: string): void => {
    const old = previous.find(g => g.id === id)
    if (old !== undefined) groups.push(old)
  }
  for (const [source, label] of SOURCES) {
    let s: unknown
    try {
      s = await $.settings.read({ source })
    } catch (err) {
      await debug($, `code-hud: settings.read ${source} failed: ${err instanceof Error ? err.message : String(err)}`)
      keep(`settings:${source}`)
      continue
    }
    if (!isObj(s) || s.hooks === undefined) continue
    const raw = flatten(s.hooks)
    if (!raw) { await debug($, `code-hud: unexpected hooks shape in ${source} settings`); continue }
    if (raw.length > 0) groups.push({ id: `settings:${source}`, label, rows: toRows(raw) })
  }
  const plugins = [...(await discoverPlugins($))].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  // Two plugins of one name (two marketplaces, an installed and a synced copy): the later ones get `#n`.
  const named = new Map<string, number>()
  for (const p of plugins) {
    const file = `${p.dir}/hooks/hooks.json`
    const n = (named.get(p.name) ?? 0) + 1
    named.set(p.name, n)
    const id = n === 1 ? `plugin:${p.name}` : `plugin:${p.name}#${n}`
    const exists = await attempt($, `exists ${file}`, () => $.fs.exists(file))
    if (exists === undefined) { keep(id); continue }
    if (!exists) continue
    const json = await readJson($, file, 'read')
    if (json === undefined) { keep(id); continue }   // unreadable or invalid JSON
    if (!isObj(json)) { await debug($, `code-hud: unexpected shape in ${file}`); continue }
    if (json.hooks === undefined) continue
    const raw = flatten(json.hooks)
    if (!raw) { await debug($, `code-hud: unexpected hooks shape in ${file}`); continue }
    if (raw.length === 0) continue
    const g: HookGroup = { id, label: `插件 ${p.name}`, file, rows: toRows(raw) }
    if (typeof json.description === 'string') g.description = json.description
    groups.push(g)
  }
  return groups
}

/** The hook's display command; `false` when the hook is not a command (http, prompt, agent); undefined when unreadable. */
export async function readHookCommand($: EngineInterface, group: HookGroup, index: number): Promise<string | false | undefined> {
  let hooks: unknown
  if (group.id.startsWith('settings:')) {
    const source = SOURCES.find(([s]) => s === group.id.slice('settings:'.length))?.[0]
    if (!source) return undefined
    const s = await attempt($, `settings.read ${source}`, () => $.settings.read({ source }))
    hooks = isObj(s) ? s.hooks : undefined
  } else {
    if (!group.file) return undefined
    const json = await readJson($, group.file, 'read')
    hooks = isObj(json) ? json.hooks : undefined
  }
  const hook = flatten(hooks)?.[index]
  if (hook?.type !== undefined && hook.type !== 'command') return false
  return hook?.command ? displayCommand(hook.command) : undefined
}
