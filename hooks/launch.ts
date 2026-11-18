import type { EngineInterface } from 'claude-code'

export type LaunchResult = { ok: true } | { ok: false; reason: string }

export function vaultPath(obsidianJson: string): string | undefined {
  try {
    const vaults = Object.values((JSON.parse(obsidianJson) as { vaults?: Record<string, { path?: unknown; open?: unknown }> }).vaults ?? {})
    const pick = vaults.find(v => v?.open === true) ?? vaults[0]
    return typeof pick?.path === 'string' && pick.path ? pick.path : undefined
  } catch {
    return undefined
  }
}

const stripDots = (s: string) => s.replace(/^\.+/, '')

function shortHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0').slice(0, 6)
}

export function linkName(file: string, type: string, taken: Record<string, string>): string {
  const parts = file.split('/').filter(Boolean)
  const base = stripDots(parts[parts.length - 1] ?? 'file') || 'file'
  const dirs = parts.slice(0, -1)
  let dir = dirs[dirs.length - 1] ?? ''
  if (dir === '.claude') dir = dirs[dirs.length - 2] ?? ''
  const prefix = type === 'User' ? 'User' : type === 'AutoMem' ? 'Memory' : type === 'Managed' ? 'Managed' : stripDots(dir) || type
  const name = `${prefix}-${base}`
  if (!(name in taken) || taken[name] === file) return name
  const stem = base.endsWith('.md') ? base.slice(0, -3) : base
  return `${prefix}-${stem}-${shortHash(file)}.md`
}

async function run($: EngineInterface, label: string, argv: string[]): Promise<LaunchResult & { stdout?: string }> {
  try {
    const r = await $.process.run(argv)
    if (r.exitCode === 0) return { ok: true, stdout: r.stdout }
    const line = (r.stderr ?? '').split('\n').find(l => l.trim()) ?? ''
    return { ok: false, reason: `无法打开 ${label}：${line.trim() || `退出码 ${r.exitCode}`}` }
  } catch (err) {
    return { ok: false, reason: `无法打开 ${label}：${err instanceof Error ? err.message : String(err)}` }
  }
}

const done = (r: LaunchResult): LaunchResult => (r.ok ? { ok: true } : r)

export async function openWarp($: EngineInterface, dir: string): Promise<LaunchResult> {
  return done(await run($, 'Warp', ['open', '-a', 'Warp', dir]))
}

export async function openObsidian($: EngineInterface): Promise<LaunchResult> {
  return done(await run($, 'Obsidian', ['open', '-a', 'Obsidian']))
}

async function readVault($: EngineInterface): Promise<string | undefined> {
  try {
    const home = await $.env.get('HOME')
    if (!home) return undefined
    return vaultPath(await $.fs.read(`${home}/Library/Application Support/obsidian/obsidian.json`))
  } catch {
    return undefined
  }
}

async function readTaken($: EngineInterface, dir: string): Promise<Record<string, string>> {
  const taken: Record<string, string> = {}
  try {
    for (const entry of await $.fs.list(dir)) {
      taken[entry.name] = ''
      if (!entry.isLink) continue
      const r = await run($, 'Obsidian', ['readlink', `${dir}/${entry.name}`])
      if (r.ok) taken[entry.name] = (r.stdout ?? '').trim()
    }
  } catch {
    // an unreadable listing leaves `taken` as far as it got; ln -s refuses to overwrite anyway
  }
  return taken
}

export async function openInObsidian($: EngineInterface, file: string, type: string): Promise<LaunchResult> {
  const vault = await readVault($)
  if (!vault) return { ok: false, reason: '找不到 Obsidian 的 vault 配置' }
  // A vault folder that was moved or deleted is not made again (no mkdir -p).
  const exists = await $.fs.exists(vault).catch(() => false)
  if (!exists) return { ok: false, reason: '找不到 vault 目录' }
  let target = file
  if (!file.startsWith(vault.replace(/\/+$/, '') + '/')) {
    const dir = `${vault}/Claude`
    const made = await run($, 'Obsidian', ['mkdir', '-p', dir])
    if (!made.ok) return done(made)
    const taken = await readTaken($, dir)
    const name = linkName(file, type, taken)
    target = `${dir}/${name}`
    if (taken[name] !== file) {
      const linked = await run($, 'Obsidian', ['ln', '-s', file, target])
      if (!linked.ok) return done(linked)
    }
  }
  return done(await run($, 'Obsidian', ['open', `obsidian://open?path=${encodeURIComponent(target)}`]))
}
