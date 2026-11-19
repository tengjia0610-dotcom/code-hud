import { atom, read, update } from 'claude-code'
import type { Atom, EngineInterface } from 'claude-code'
import type { Dynamic, HookGroup, Mascot, McpServer, MemoryFile, ModeState, SettingsFile, Ui, View } from '../types'

// The eight `$.state` values of the mod. Bump a shape tag when that value's fields change.
// The engine's scan accepts `read`/`update` only on an atom declared as a const of the calling file, so every
// state read and write lives here, beside the atoms, behind a helper.
export const dynamic = atom({ plugin: 'code-hud', key: 'dynamic' } as const, {}, { shape: 'dynamic-1' })
export const memory = atom({ plugin: 'code-hud', key: 'memory' } as const, [], { shape: 'memory-1' })
export const servers = atom({ plugin: 'code-hud', key: 'servers' } as const, [], { shape: 'servers-1' })
export const hooks = atom({ plugin: 'code-hud', key: 'hooks' } as const, [], { shape: 'hooks-1' })
export const settings = atom({ plugin: 'code-hud', key: 'settings' } as const, [], { shape: 'settings-1' })
export const mascot = atom({ plugin: 'code-hud', key: 'mascot' } as const, {}, { shape: 'mascot-1' })
export const ui = atom({ plugin: 'code-hud', key: 'ui' } as const, { view: 'claudemd', openGroups: [] }, { shape: 'ui-1' })
// The contract declares `Shaped<ModeState> | null`; `atom`'s shaped overload types its initial as ModeState alone,
// so the null initial (read until a mode is known) needs the cast.
export const mode: Atom<ModeState | null> = atom({ plugin: 'code-hud', key: 'mode' } as const, null as never, { shape: 'mode-1' })

export const isSame = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// ---- writes: no change, no write (so the band does not redraw for nothing) ----

/** Merges the keys a collection obtained into the stored Dynamic and removes the `cleared` ones; resolves to what stands. */
export async function mergeDynamic($: EngineInterface, partial: Partial<Dynamic>, cleared: (keyof Dynamic)[] = []): Promise<Dynamic> {
  const merge = (stored: Dynamic): Dynamic => {
    const next: Dynamic = { ...stored, ...partial }
    for (const key of cleared) delete next[key]
    return next
  }
  const current = await read($, dynamic)
  if (isSame(current, merge(current))) return current
  return update($, dynamic, merge)
}

/** Removes `usageResetsAt` while it is still `at`. */
export async function dropUsageReset($: EngineInterface, at: string): Promise<void> {
  if ((await read($, dynamic)).usageResetsAt !== at) return
  await update($, dynamic, ({ usageResetsAt, ...rest }) => (usageResetsAt === at ? rest : { usageResetsAt, ...rest }))
}

export async function setMemory($: EngineInterface, value: MemoryFile[]): Promise<void> {
  if (!isSame(await read($, memory), value)) await update($, memory, () => value)
}

export async function setServers($: EngineInterface, value: McpServer[]): Promise<void> {
  if (!isSame(await read($, servers), value)) await update($, servers, () => value)
}

export async function setHooks($: EngineInterface, value: HookGroup[]): Promise<void> {
  if (!isSame(await read($, hooks), value)) await update($, hooks, () => value)
}

export async function setSettings($: EngineInterface, value: SettingsFile[]): Promise<void> {
  if (!isSame(await read($, settings), value)) await update($, settings, () => value)
}

/** A mode a classic event reported. */
export async function setConfirmedMode($: EngineInterface, value: string): Promise<void> {
  const next: ModeState = { value, isConfirmed: true }
  if (!isSame(await read($, mode), next)) await update($, mode, () => next)
}

/** The settings' default mode, unless an event has confirmed one already. */
export async function setDefaultMode($: EngineInterface, value: string): Promise<void> {
  const next: ModeState = { value, isConfirmed: false }
  const current = await read($, mode)
  if (current?.isConfirmed || isSame(current, next)) return
  await update($, mode, stored => (stored?.isConfirmed ? stored : next))
}

/** The pane's view; written only when it changes. Leaving the file view drops its path and revision. */
export async function setView($: EngineInterface, view: View): Promise<void> {
  const current = await read($, ui)
  if (current.view === view && current.filePath === undefined && current.fileRev === undefined) return
  await update($, ui, ({ filePath, fileRev, ...rest }) => ({ ...rest, view }))
}

/** Shows one file in the pane's file view. */
export async function openFile($: EngineInterface, path: string): Promise<void> {
  await update($, ui, stored => ({ ...stored, view: 'file' as const, filePath: path }))
}

/** Asks the file view to read its file again. */
export async function refreshFile($: EngineInterface): Promise<void> {
  await update($, ui, stored => ({ ...stored, fileRev: (stored.fileRev ?? 0) + 1 }))
}

/** The MCP server the pane's detail shows; undefined goes back to the list. */
export async function setServerId($: EngineInterface, id: string | undefined): Promise<void> {
  await update($, ui, ({ serverId, ...rest }) => (id === undefined ? rest : { ...rest, serverId: id }))
}

/** Opens a hooks group when it is folded, folds it when it is open. */
export async function toggleGroup($: EngineInterface, id: string): Promise<void> {
  await update($, ui, stored => ({
    ...stored,
    openGroups: stored.openGroups.includes(id) ? stored.openGroups.filter(g => g !== id) : [...stored.openGroups, id],
  }))
}

/** Shows one hook's command; the same hook again hides it. */
export async function toggleHook($: EngineInterface, group: string, index: number): Promise<void> {
  await update($, ui, ({ openHook, ...rest }) =>
    (openHook?.group === group && openHook.index === index ? rest : { ...rest, openHook: { group, index } }))
}

// ---- reads ----

export async function readMemory($: EngineInterface): Promise<MemoryFile[]> {
  return read($, memory)
}

export async function readServers($: EngineInterface): Promise<McpServer[]> {
  return read($, servers)
}

export async function readHooks($: EngineInterface): Promise<HookGroup[]> {
  return read($, hooks)
}

export async function readSettings($: EngineInterface): Promise<SettingsFile[]> {
  return read($, settings)
}

export async function readDynamic($: EngineInterface): Promise<Dynamic> {
  return read($, dynamic)
}

export async function readMode($: EngineInterface): Promise<ModeState | null> {
  return read($, mode)
}

export async function readUi($: EngineInterface): Promise<Ui> {
  return read($, ui)
}

/** What the band's four buttons count; `hooks` is every row across the groups. */
export async function readCounts($: EngineInterface): Promise<{ memory: number; servers: number; hooks: number; settings: number }> {
  const [files, list, groups, found] = await Promise.all([read($, memory), read($, servers), read($, hooks), read($, settings)])
  return {
    memory: files.length, servers: list.length, hooks: groups.reduce((sum, group) => sum + group.rows.length, 0), settings: found.length,
  }
}

export async function readMascot($: EngineInterface): Promise<Mascot> {
  return read($, mascot)
}

/** Applies `change` to the mascot; resolves to the new state when that wrote, else undefined. */
export async function changeMascot($: EngineInterface, change: (state: Mascot) => Mascot): Promise<Mascot | undefined> {
  const before = await read($, mascot)
  if (isSame(change(before), before)) return undefined
  return update($, mascot, change)
}
