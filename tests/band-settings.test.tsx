import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { visibleSegments } from '../hooks/band'

const BAND = {
  plugin: 'code-hud', component: 'AbovePrompt', surface: 'desktop',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const

const PANE = {
  plugin: 'code-hud', component: 'Pane', requestId: 'code-hud', surface: 'desktop',
  props: { title: 'Code HUD', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// HOME is /h, the session root /p; both settings.json files exist.
function engine(on: On): { opened: unknown[]; clock: ReturnType<typeof mock.clock> } {
  const opened: unknown[] = []
  const exists = new Set(['/h/.claude/settings.json', '/p/.claude/settings.json'])
  const clock = mock.clock(on, { now: 1795000000000 })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('session.root', () => ({ value: '/p' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.exists', (_, e) => ({ value: exists.has(e.path) }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  return { opened, clock }
}

test('row 2 keeps launch at 76 columns and drops it at 75', async () => {
  expect(visibleSegments(76).has('counts')).toBe(true)
  expect(visibleSegments(76).has('launch')).toBe(true)
  expect(visibleSegments(75).has('counts')).toBe(true)
  expect(visibleSegments(75).has('launch')).toBe(false)
})

test('the band shows settings.json after hooks, and opens the settings view', async ($, on) => {
  const { opened, clock } = engine(on)
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  await clock.advance(0)
  const ui = await $.ui.mount(BAND)
  const buttons = await ui.findAll({ type: 'Button' })
  const keys = buttons.map(b => b.key)
  expect(keys.indexOf('band-settings')).toBe(keys.indexOf('band-hooks') + 1)
  expect(buttons.find(b => b.key === 'band-settings')?.text).toBe('settings.json 2')
  await ui.press({ key: 'band-settings' })
  expect(opened).toContainEqual(expect.objectContaining({ id: 'code-hud' }))
  await ui.unmount()
  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ key: 'tab-settings' }))?.props.variant).toBe('primary')
  await pane.unmount()
})

test('the widget counts settings.json', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  await clock.advance(0)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' } })
  expect(await ui.find({ type: 'Text', text: 'CLAUDE.md 0 · MCP 0 · hooks 0 · settings.json 2' })).toBeDefined()
  await ui.unmount()
})

test('the drawn band keeps settings.json and drops the launch buttons at 75 columns', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  await clock.advance(0)
  for (const [columns, hasLaunch] of [[76, true], [75, false]] as const) {
    const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: columns } })
    const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key)
    expect(keys).toContain('band-settings')
    expect(keys.includes('band-warp')).toBe(hasLaunch)
    expect(keys.includes('band-obsidian')).toBe(hasLaunch)
    await ui.unmount()
  }
})
