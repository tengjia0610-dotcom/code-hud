import type { EngineInterface } from 'claude-code'
import type { MemoryFile, SettingsFile } from '../types'

/** The settings files the pane can list, user first. A root that is HOME has no project level: its `.claude` is the user's. */
export function settingsCandidates(home: string, root: string): SettingsFile[] {
  const user: SettingsFile = { path: `${home}/.claude/settings.json`, level: 'user' }
  if (root.replace(/\/+$/, '') === home.replace(/\/+$/, '')) return [user]
  return [
    user,
    { path: `${root}/.claude/settings.json`, level: 'project' },
    { path: `${root}/.claude/settings.local.json`, level: 'local' },
  ]
}

/** The candidates that exist; undefined when HOME, the root or any check could not be read (the caller keeps what it stored). */
export async function collectSettings($: EngineInterface): Promise<SettingsFile[] | undefined> {
  try {
    const [home, root] = await Promise.all([$.env.get('HOME'), $.session.root()])
    if (!home || !root) return undefined
    const candidates = settingsCandidates(home, root)
    const exists = await Promise.all(candidates.map(file => $.fs.exists(file.path)))
    return candidates.filter((_, i) => exists[i])
  } catch {
    return undefined
  }
}

/** Which list a file view's path belongs to: it decides how the file is drawn, opened and left; undefined is no listed file. */
export function fileKind(path: string | undefined, memory: MemoryFile[], settings: SettingsFile[]): 'claudemd' | 'settings' | undefined {
  if (path === undefined) return undefined
  if (memory.some(f => f.path === path)) return 'claudemd'
  if (settings.some(f => f.path === path)) return 'settings'
  return undefined
}

const SETTINGS_PATH = /\/\.claude\/settings(\.local)?\.json$/

/**
 * How a file view draws, opens and leaves its path: settings for a settings-shaped path not in the CLAUDE.md list, even
 * after it dropped out of the settings list (deleted, root moved). Never a gate: only `fileKind` decides what is read.
 */
export function viewKind(path: string | undefined, memory: MemoryFile[]): 'claudemd' | 'settings' {
  if (path === undefined || memory.some(f => f.path === path)) return 'claudemd'
  return SETTINGS_PATH.test(path) ? 'settings' : 'claudemd'
}
