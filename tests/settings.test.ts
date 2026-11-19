import { expect, test } from 'claude-code/testing'
import { settingsCandidates } from '../hooks/settings'

test('candidates: user, project, local in order', async () => {
  expect(settingsCandidates('/h', '/p')).toEqual([
    { path: '/h/.claude/settings.json', level: 'user' },
    { path: '/p/.claude/settings.json', level: 'project' },
    { path: '/p/.claude/settings.local.json', level: 'local' },
  ])
})

test('candidates: a root that is HOME has no project level, only the user file', async () => {
  expect(settingsCandidates('/h', '/h')).toEqual([{ path: '/h/.claude/settings.json', level: 'user' }])
  expect(settingsCandidates('/h', '/h/')).toEqual([{ path: '/h/.claude/settings.json', level: 'user' }])
})
