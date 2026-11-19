import type { EngineInterface, Register, Timer } from 'claude-code'
import type { Mascot, View } from '../types'
import { Band } from './band'
import { collectDynamic, collectHooks, collectSession, readHookCommand } from './collect'
import { openInObsidian, openObsidian, openWarp, type LaunchResult } from './launch'
import { nextMascot, pose, SLEEP_MS, type MascotEvent } from './mascot'
import { Pane } from './pane'
import { collectSettings, fileKind, viewKind } from './settings'
import {
  changeMascot, dropUsageReset, mergeDynamic, openFile, refreshFile, readCounts, readDynamic, readHooks, readMascot, readMemory, readMode,
  readServers, readSettings, readUi, setConfirmedMode, setDefaultMode, setHooks, setMemory, setServerId, setServers, setSettings, setView,
  toggleGroup, toggleHook,
} from './state'

const TICK_MS = 30_000

// The desktop latch (spec 5.7): once set it stays set; a hot reload starts these over.
let isDesktop = false
let isStarted = false
// Timer handles: cancelled and re-armed, never stacked.
let tick: Timer | undefined
let moodTimer: Timer | undefined
let sleepTimer: Timer | undefined
let resetTimer: Timer | undefined
let resetFor: string | undefined
// Mascot steps run one after another, in the order the hooks saw the events.
let mascotQueue: Promise<void> = Promise.resolve()
// A main turn is running (set by its prompt or a tool call, cleared by its end or a session start): no sleep timer then.
let isTurnRunning = false

// Never throws: a failure to log must not break the caller's chain.
function log($: EngineInterface, error: unknown): void {
  try {
    $.ui.log(String(error), { to: 'debug' })
  } catch {
    // nothing left to tell
  }
}

// Runs work without the hook waiting for it; a failure goes to the debug log.
function background($: EngineInterface, work: Promise<unknown>): void {
  void work.catch(error => log($, error))
}

// ---- the latch ----

function latch($: EngineInterface): void {
  isDesktop = true
  start($)
}

// A render may not write state: the start runs outside it. `isDesktop` only stops renders scheduling it again; if the
// scheduled start never runs, the next session.start, turn end or attach still starts (they test `isStarted`).
function latchFromRender($: EngineInterface): void {
  if (isDesktop) return
  isDesktop = true
  $.clock.after(0, () => start($))
}

async function checkSurfaces($: EngineInterface): Promise<void> {
  if (isStarted) return
  if ((await $.session.surfaces()).includes('desktop')) latch($)
}

function start($: EngineInterface): void {
  if (isStarted) return
  isStarted = true
  feed($, { type: 'start' })
  queue($, () => rearm($))
  tick = $.clock.every(TICK_MS, () => background($, refreshDynamic($)))
  background($, initMode($))
  background($, refreshDynamic($))
  background($, refreshSession($))
  background($, refreshHooks($))
  background($, refreshSettings($))
}

// ---- collection ----

async function refreshDynamic($: EngineInterface): Promise<void> {
  const { cleared, ...partial } = await collectDynamic($)
  const now = await $.clock.now()
  // A reset time already past is no reset clock: the last API response can still report it.
  if (partial.usageResetsAt !== undefined && !(Date.parse(partial.usageResetsAt) > now)) delete partial.usageResetsAt
  const stored = await mergeDynamic($, partial, cleared)
  armReset($, stored.usageResetsAt, now)
}

async function refreshSession($: EngineInterface): Promise<void> {
  const session = await collectSession($)
  if (session === undefined) return   // a failed read keeps what is stored
  await setMemory($, session.memory)
  await setServers($, session.servers)
}

async function refreshHooks($: EngineInterface): Promise<void> {
  await setHooks($, await collectHooks($, await readHooks($)))
}

// Numbers each settings collection: only the latest may write, so an older, slower one never lands over a newer one.
let settingsRun = 0

async function refreshSettings($: EngineInterface): Promise<void> {
  const run = ++settingsRun
  const found = await collectSettings($)
  if (run !== settingsRun) return
  if (found !== undefined) await setSettings($, found)   // a failed check keeps what is stored
}

/** Collects again what a view shows. */
async function refreshFor($: EngineInterface, view: View): Promise<void> {
  if (view === 'hooks') await refreshHooks($)
  else if (view === 'settings') await refreshSettings($)
  else await refreshSession($)
}

function armReset($: EngineInterface, at: string | undefined, now: number): void {
  if (at === resetFor) return
  resetTimer?.cancel()
  resetTimer = undefined
  resetFor = at
  if (at === undefined) return
  const ms = Date.parse(at) - now
  if (ms > 0) resetTimer = $.clock.after(ms, () => background($, resetDue($, at)))
  else background($, dropUsageReset($, at)) // stored before and already past (a reload): no reset clock
}

// At the usage window's reset: collect again, and drop the reset clock if it still stands (a write, so the band redraws).
async function resetDue($: EngineInterface, at: string): Promise<void> {
  resetTimer = undefined
  await refreshDynamic($)
  await dropUsageReset($, at)
}

// ---- permission mode ----

async function initMode($: EngineInterface): Promise<void> {
  const permissions: unknown = await $.settings.read({ key: 'permissions' })
  const value = typeof permissions === 'object' && permissions !== null && 'defaultMode' in permissions ? permissions.defaultMode : undefined
  if (typeof value !== 'string' || value === '') return
  await setDefaultMode($, value)
}

function noteMode($: EngineInterface, e: { permission_mode?: string; agent_id?: string }): void {
  if (!isStarted || e.agent_id !== undefined || !e.permission_mode) return
  background($, setConfirmedMode($, e.permission_mode))
}

// ---- mascot ----

function queue($: EngineInterface, work: () => Promise<void>): void {
  // Each step's failure is caught on its own, so the chain always goes on to the next step.
  mascotQueue = mascotQueue.then(() => work().catch(error => log($, error)))
}

function feed($: EngineInterface, event: MascotEvent): void {
  if (isStarted) queue($, () => step($, event))
}

async function step($: EngineInterface, event: MascotEvent): Promise<void> {
  if (event.type === 'prompt' || event.type === 'tool') isTurnRunning = true
  else if (event.type === 'turnEnd' || event.type === 'start') isTurnRunning = false
  const now = await $.clock.now()
  const changed = await changeMascot($, state => nextMascot(state, event, now))
  if (changed) armMascot($, changed, now)
}

async function rearm($: EngineInterface): Promise<void> {
  armMascot($, await readMascot($), await $.clock.now())
}

// The reducer ignores stale timer events; these only deliver them.
function armMascot($: EngineInterface, state: Mascot, now: number): void {
  moodTimer?.cancel()
  moodTimer = undefined
  sleepTimer?.cancel()
  sleepTimer = undefined
  const { mood, until, idleSince } = state
  if (mood !== undefined && until !== undefined) {
    moodTimer = $.clock.after(Math.max(0, until - now), () => feed($, { type: 'expire', mood, until }))
  }
  if (idleSince !== undefined && mood !== 'sleeping' && !isTurnRunning) {
    sleepTimer = $.clock.after(Math.max(0, idleSince + SLEEP_MS - now), () => feed($, { type: 'idleTimeout', idleSince }))
  }
}

// ---- band presses (never throw: a failure goes to the debug log) ----

const PANE_ID = 'code-hud'

/** A count button: closes the pane when it is open on this view, else shows this view in it and collects that view again. */
async function pressView($: EngineInterface, view: View): Promise<void> {
  try {
    // Shown, not just open: a pane behind another plugin's tab is shown by a press, not closed.
    const isShown = (await $.ui.panes()).some(pane => pane.id === PANE_ID && pane.isShown)
    if (isShown && (await readUi($)).view === view) {
      await $.ui.close({ id: PANE_ID })
      return
    }
    await setView($, view)
    await $.ui.open({ id: PANE_ID, title: 'Code HUD' })
    background($, refreshFor($, view))
  } catch (error) {
    log($, error)
  }
}

async function pressLaunch($: EngineInterface, launch: () => Promise<LaunchResult>): Promise<void> {
  try {
    const result = await launch()
    if (!result.ok) $.ui.toast(result.reason)
  } catch (error) {
    log($, error)
  }
}

async function pressWarp($: EngineInterface): Promise<void> {
  await pressLaunch($, async () => openWarp($, (await $.session.repo())?.root ?? (await $.session.root())))
}

async function pressObsidian($: EngineInterface): Promise<void> {
  await pressLaunch($, () => openObsidian($))
}

// ---- pane presses (never throw: a failure goes to the debug log) ----

/** A tab: shows its view and collects that view's values again. */
async function pressTab($: EngineInterface, view: View): Promise<void> {
  try {
    await setView($, view)
    await refreshFor($, view)
  } catch (error) {
    log($, error)
  }
}

/** Runs a pane write; a failure goes to the debug log. */
async function pressWrite($: EngineInterface, write: () => Promise<void>): Promise<void> {
  try {
    await write()
  } catch (error) {
    log($, error)
  }
}

/** The file view's Obsidian button: the type comes from the memory entry the view shows. */
async function pressFileObsidian($: EngineInterface): Promise<void> {
  try {
    const [files, ui] = await Promise.all([readMemory($), readUi($)])
    const file = files.find(f => f.path === ui.filePath)
    if (file === undefined) $.ui.toast('读不到这个文件')
    else await pressLaunch($, () => openInObsidian($, file.path, file.type))
  } catch (error) {
    log($, error)
  }
}

/** A settings file in Warp; `path` undefined is the file the file view shows. Only a listed file opens. */
async function pressWarpFile($: EngineInterface, row?: string): Promise<void> {
  try {
    const [files, ui] = await Promise.all([readSettings($), readUi($)])
    const path = row ?? ui.filePath
    if (path === undefined || !files.some(f => f.path === path)) $.ui.toast('读不到这个文件')
    else await pressLaunch($, () => openWarp($, path))
  } catch (error) {
    log($, error)
  }
}

async function pressObsidianFile($: EngineInterface, path: string): Promise<void> {
  try {
    const file = (await readMemory($)).find(f => f.path === path)
    if (file !== undefined) await pressLaunch($, () => openInObsidian($, file.path, file.type))
  } catch (error) {
    log($, error)
  }
}

// ---- entry points ----

async function onSessionStart($: EngineInterface): Promise<void> {
  if (isStarted) feed($, { type: 'start' })
  else await checkSurfaces($)
}

async function onTurnEnd($: EngineInterface, isAnswer: boolean): Promise<void> {
  const wasStarted = isStarted
  await checkSurfaces($)
  if (!isStarted) return
  feed($, { type: 'turnEnd', isAnswer })
  if (!wasStarted) return // start() has just collected every tier
  background($, refreshDynamic($))
  background($, refreshSession($))
  background($, refreshSettings($))
}

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    background($, onSessionStart($))
    return next(e)
  })

  on('session.attach', ($, e, next) => {
    if (e.surface === 'desktop') latch($)
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) background($, onTurnEnd($, e.reason === 'answer'))
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    feed($, { type: 'prompt' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!isStarted || e.agentId !== undefined) return next(e)   // a session that never latched: out of the chain
    feed($, { type: 'tool' })
    try {
      const result = await next(e)
      feed($, { type: 'toolDone' })
      if (result.isError === true) feed($, { type: 'toolError' })
      return result
    } catch (error) {
      feed($, { type: 'toolDone' })
      feed($, { type: 'toolError' })
      throw error
    }
  })

  on('classic.PermissionRequest', ($, e, next) => {
    if (e.agent_id === undefined) feed($, { type: 'attention' })
    return next(e)
  })

  on('classic.Notification', ($, e, next) => {
    if (e.agent_id === undefined) feed($, { type: 'attention' })
    return next(e)
  })

  on('classic.UserPromptSubmit', ($, e, next) => {
    noteMode($, e)
    return next(e)
  })

  on('classic.PostToolUse', ($, e, next) => {
    noteMode($, e)
    return next(e)
  })

  on('classic.Stop', ($, e, next) => {
    noteMode($, e)
    return next(e)
  })

  // A new working directory is a new project: its settings files are listed without waiting for the turn's end.
  on('classic.CwdChanged', ($, e, next) => {
    if (isStarted && e.agent_id === undefined) background($, refreshSettings($))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    latchFromRender($)
    if (e.props.hasSurvey) return next(e)
    // A failed read or build must not break the session: log it and leave the row to the engine.
    try {
      const [dynamic, mode, counts, mascot, now] = await Promise.all([
        readDynamic($), readMode($), readCounts($), readMascot($), $.clock.now(),
      ])
      return Band($.ui.resolve(e), {
        dynamic, mode, counts, now, pose: pose(mascot, e.props.isWorking, now), columns: e.props.bodyColumns,
      }, {
        onView: view => pressView($, view),
        onWarp: () => pressWarp($),
        onObsidian: () => pressObsidian($),
      })
    } catch (error) {
      log($, error)
      return next(e)
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    latchFromRender($)
    // A failed read or build must not break the session: log it and leave the pane to the engine.
    try {
      const [dynamic, memory, servers, hooks, settings, ui, now, home, cwd] = await Promise.all([
        readDynamic($), readMemory($), readServers($), readHooks($), readSettings($), readUi($), $.clock.now(), $.env.get('HOME'), $.session.root(),
      ])
      // The command is read while drawing and handed to the tree only: never stored.
      const openHook = ui.openHook
      const group = openHook === undefined || !ui.openGroups.includes(openHook.group) ? undefined : hooks.find(g => g.id === openHook.group)
      // The file's text is read while drawing and handed to the tree only: never stored. Only a listed file.
      let fileText: string | undefined
      let fileError: string | undefined
      if (ui.view === 'file' && e.props.placement !== 'widget') {   // a widget draws no file
        try {
          if (ui.filePath === undefined || fileKind(ui.filePath, memory, settings) === undefined) throw new Error('not a listed file')
          fileText = await $.fs.read(ui.filePath)
        } catch (error) {
          fileError = String(error)
        }
      }
      const hookCommand = group === undefined || openHook === undefined ? undefined : await readHookCommand($, group, openHook.index)
      return Pane($.ui.resolve(e), {
        dynamic, memory, servers, hooks, settings, ui, now, home: home ?? '', cwd,
        placement: e.props.placement,
        ...(hookCommand === undefined ? {} : { hookCommand }),
        ...(fileText === undefined ? {} : { fileText }),
        ...(fileError === undefined ? {} : { fileError }),
      }, {
        onTab: view => pressTab($, view),
        onSee: path => pressWrite($, async () => {
          if ((await readMemory($)).some(f => f.path === path)) await openFile($, path)
        }),
        onSeeSettings: path => pressWrite($, async () => {
          if ((await readSettings($)).some(f => f.path === path)) await openFile($, path)
        }),
        onWarpFile: path => pressWarpFile($, path),
        onFileWarp: () => pressWarpFile($),
        onObsidianFile: path => pressObsidianFile($, path),
        onServer: id => pressWrite($, () => setServerId($, id)),
        onBack: () => pressWrite($, () => setServerId($, undefined)),
        onFileBack: () => pressWrite($, async () => {
          const [files, current] = await Promise.all([readMemory($), readUi($)])
          await setView($, viewKind(current.filePath, files))
        }),
        onRefresh: () => pressWrite($, () => refreshFile($)),
        onFileObsidian: () => pressFileObsidian($),
        onGroup: id => pressWrite($, () => toggleGroup($, id)),
        onHook: (id, index) => pressWrite($, () => toggleHook($, id, index)),
      })
    } catch (error) {
      log($, error)
      return next(e)
    }
  })
}
