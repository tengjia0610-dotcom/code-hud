import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'code-hud', component: 'Pane', requestId: 'code-hud', surface: 'desktop',
  props: { title: 'Code HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const USER = '/h/.claude/settings.json'
const PROJECT = '/p/.claude/settings.json'
const LOCAL = '/p/.claude/settings.local.json'

type World = {
  root: string
  exists: Set<string>
  existsThrows: boolean
  check?: (path: string) => Promise<boolean>
  files: Record<string, string>
  reads: string[]
  runs: string[][]
  toasts: string[]
  memory: { path: string; type: string; tokens: number }[]
}

// Stands in for the engine beneath the mod: HOME is /h, the session root /p.
function engine(on: On, world: Partial<World> = {}): World & { clock: ReturnType<typeof mock.clock> } {
  const w: World = {
    root: '/p', exists: new Set([USER, PROJECT]), existsThrows: false, files: {}, reads: [], runs: [], toasts: [], memory: [], ...world,
  }
  const clock = mock.clock(on, { now: 1795000000000 })
  on('turn.complete', () => ({ text: '' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('session.root', () => ({ value: w.root }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('fs.exists', async (_, e) => {
    if (w.existsThrows) throw new Error('EACCES')
    return { value: w.check ? await w.check(e.path) : w.exists.has(e.path) }
  })
  on('fs.read', (_, e) => {
    w.reads.push(e.path)
    const text = w.files[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('process.run', (_, e) => {
    w.runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(String(e.text))
    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { breakdown: { memoryFiles: w.memory, mcpTools: [] } } } as never,
  }))
  return Object.assign(w, { clock })   // the same object the hooks read: a test's writes reach them
}

const keys = async (ui: { findAll(q: { type: string }): Promise<{ key: string | undefined }[]> }): Promise<string[]> =>
  (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')

test('settings tab lists the files that exist', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-settings' })
  expect((await ui.find({ key: 'tab-settings' }))?.text).toBe('settings.json 2')
  const paths = (await ui.findAll({ type: 'Text', text: /settings(\.local)?\.json$/ })).map(t => t.text)
  expect(paths).toEqual(['~/.claude/settings.json', './.claude/settings.json'])
  const shown = await keys(ui)
  for (const k of ['set-see-0', 'set-warp-0', 'set-see-1', 'set-warp-1']) expect(shown).toContain(k)
  expect(shown).not.toContain('set-see-2')
  await ui.unmount()
})

test('only existing files: user and local', async ($, on) => {
  engine(on, { exists: new Set([USER, LOCAL]) })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-settings' })
  const paths = (await ui.findAll({ type: 'Text', text: /settings(\.local)?\.json$/ })).map(t => t.text)
  expect(paths).toEqual(['~/.claude/settings.json', './.claude/settings.local.json'])
  await ui.unmount()
})

test('an exists check that throws keeps the stored list', async ($, on) => {
  const w = engine(on)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-settings' })
  w.existsThrows = true
  await ui.press({ key: 'tab-claudemd' })
  await ui.press({ key: 'tab-settings' })
  expect((await ui.find({ key: 'tab-settings' }))?.text).toBe('settings.json 2')
  await ui.unmount()
})

test('view shows json as code with a Warp button', async ($, on) => {
  engine(on, { files: { [USER]: '{"a":1}' } })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-settings' })
  await ui.press({ key: 'set-see-0' })
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.source).toBe('{"a":1}')
  expect(code?.props.language).toBe('json')
  const shown = await keys(ui)
  expect(shown).toContain('file-warp')
  expect(shown).not.toContain('file-obsidian')
  await ui.unmount()
})

test('back returns to the settings tab', async ($, on) => {
  engine(on, { files: { [USER]: '{}' } })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-settings' })
  await ui.press({ key: 'set-see-0' })
  await ui.press({ key: 'back' })
  expect((await ui.find({ key: 'tab-settings' }))?.props.variant).toBe('primary')
  expect(await keys(ui)).toContain('set-see-0')
  await ui.unmount()
})

test('Warp opens the file, from the row and from the file view', async ($, on) => {
  const w = engine(on, { files: { [USER]: '{}' } })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-settings' })
  await ui.press({ key: 'set-warp-1' })
  expect(w.runs.at(-1)).toEqual(['open', '-a', 'Warp', PROJECT])
  await ui.press({ key: 'set-see-0' })
  await ui.press({ key: 'file-warp' })
  expect(w.runs.at(-1)).toEqual(['open', '-a', 'Warp', USER])
  expect(w.toasts).toEqual([])
  await ui.unmount()
})

test('a file deleted after listing reads as unreadable', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-settings' })
  await ui.press({ key: 'set-see-0' })
  expect(await ui.find({ type: 'Text', text: '读不到这个文件：~/.claude/settings.json' })).toBeDefined()
  await ui.unmount()
})

test('an empty file and invalid json are shown as they are', async ($, on) => {
  const w = engine(on, { files: { [USER]: '', [PROJECT]: '{oops' } })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-settings' })
  await ui.press({ key: 'set-see-0' })
  expect(await ui.find({ type: 'Text', text: '这个文件是空的' })).toBeDefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'set-see-1' })
  expect((await ui.find({ type: 'Code' }))?.props.source).toBe('{oops')
  expect(w.toasts).toEqual([])
  await ui.unmount()
})

test('a file no longer listed is not read', async ($, on) => {
  const w = engine(on, { files: { [PROJECT]: '{}' } })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-settings' })
  await ui.press({ key: 'set-see-1' })
  w.exists.delete(PROJECT)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 't1' } as never)
  await w.clock.advance(0)
  const before = w.reads.filter(p => p === PROJECT).length
  expect(await ui.find({ type: 'Text', text: '读不到这个文件：./.claude/settings.json' })).toBeDefined()
  await ui.press({ key: 'refresh' })
  expect(w.reads.filter(p => p === PROJECT).length).toBe(before)
  await ui.unmount()
})

test('a CLAUDE.md file view keeps Obsidian and returns to CLAUDE.md', async ($, on) => {
  engine(on, { memory: [{ path: '/h/.claude/CLAUDE.md', type: 'User', tokens: 10 }], files: { '/h/.claude/CLAUDE.md': '# hi' } })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-claudemd' })
  await ui.press({ key: 'see-0' })
  const shown = await keys(ui)
  expect(shown).toContain('file-obsidian')
  expect(shown).not.toContain('file-warp')
  await ui.press({ key: 'back' })
  expect((await ui.find({ key: 'tab-claudemd' }))?.props.variant).toBe('primary')
  await ui.unmount()
})

test('a settings file that drops out of the list keeps Warp and returns to settings', async ($, on) => {
  const w = engine(on, { exists: new Set([USER, LOCAL]), files: { [LOCAL]: '{}' } })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-settings' })
  await ui.press({ key: 'set-see-1' })
  w.exists.delete(LOCAL)
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 0, isAborted: false, turnId: 't1' } as never)
  await w.clock.advance(0)
  expect(await ui.find({ type: 'Text', text: '读不到这个文件：./.claude/settings.local.json' })).toBeDefined()
  const shown = await keys(ui)
  expect(shown).toContain('file-warp')
  expect(shown).not.toContain('file-obsidian')
  await ui.press({ key: 'back' })
  expect((await ui.find({ key: 'tab-settings' }))?.props.variant).toBe('primary')
  await ui.unmount()
})

test('a session rooted at HOME lists the user file once, as ~', async ($, on) => {
  engine(on, { root: '/h', exists: new Set([USER, '/h/.claude/settings.local.json']) })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-settings' })
  expect((await ui.find({ key: 'tab-settings' }))?.text).toBe('settings.json 1')
  const paths = (await ui.findAll({ type: 'Text', text: /settings(\.local)?\.json$/ })).map(t => t.text)
  expect(paths).toEqual(['~/.claude/settings.json'])
  await ui.unmount()
})

test('an older, slower refresh does not overwrite a newer one', async ($, on) => {
  let release: () => void = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  let present = new Set([USER])
  let started: () => void = () => {}
  const firstStarted = new Promise<void>(resolve => { started = resolve })
  // The first refresh's three checks wait until released, and see USER only.
  engine(on, {
    check: async path => {
      calls += 1
      const seen = present
      if (calls === 3) started()
      if (calls <= 3) await held
      return seen.has(path)
    },
  })
  const ui = await $.ui.mount(PANE)
  const slow = ui.press({ key: 'tab-settings' })
  await firstStarted
  present = new Set([USER, PROJECT, LOCAL])
  const fast = ui.press({ key: 'tab-settings' })
  await fast
  release()
  await slow
  expect((await ui.find({ key: 'tab-settings' }))?.text).toBe('settings.json 3')
  await ui.unmount()
})

test('a working directory change lists the new project at once', async ($, on) => {
  const w = engine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.CwdChanged', () => ({}))
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  await w.clock.advance(0)
  w.root = '/q'
  w.exists = new Set([USER])   // /q has no project settings: the count drops from 2 to 1
  await $.classic.CwdChanged({ old_cwd: '/p', new_cwd: '/q' })
  await w.clock.advance(0)
  // Drawn without a press of its own: only the directory change can have collected again.
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ key: 'tab-settings' }))?.text).toBe('settings.json 1')
  await ui.unmount()
})

test('a CLAUDE.md row opens its own file in Obsidian', async ($, on) => {
  const vault = '/h/vault'
  const w = engine(on, {
    exists: new Set([USER, vault]),
    memory: [{ path: '/h/.claude/CLAUDE.md', type: 'User', tokens: 1 }, { path: `${vault}/CLAUDE.md`, type: 'Project', tokens: 1 }],
    files: { '/h/Library/Application Support/obsidian/obsidian.json': JSON.stringify({ vaults: { a: { path: vault, open: true } } }) },
  })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-claudemd' })
  await ui.press({ key: 'obs-1' })
  expect(w.runs.at(-1)).toEqual(['open', `obsidian://open?path=${encodeURIComponent(`${vault}/CLAUDE.md`)}`])
  expect(w.toasts).toEqual([])
  await ui.unmount()
})
