import type { Mascot, Mood } from '../types'

export type MascotEvent =
  | { type: 'start' } | { type: 'prompt' } | { type: 'tool' } | { type: 'toolDone' } | { type: 'toolError' }
  | { type: 'turnEnd'; isAnswer: boolean } | { type: 'attention' }
  | { type: 'idleTimeout'; idleSince: number } | { type: 'expire'; mood: Mood; until: number }

export type Pose = 'idle' | 'working' | Mood

export const FLASH_MS = 3000
export const WAIT_MS = 300000
export const SLEEP_MS = 300000

const keepIdle = (s: Mascot): Mascot => (s.idleSince === undefined ? {} : { idleSince: s.idleSince })
const withMood = (s: Mascot, mood: Mood, until?: number): Mascot =>
  ({ ...keepIdle(s), mood, ...(until === undefined ? {} : { until }) })
const without = (s: Mascot, moods: Mood[]): Mascot =>
  (s.mood !== undefined && moods.includes(s.mood) ? keepIdle(s) : s)
const isLive = (s: Mascot, now: number): boolean => s.mood !== undefined && (s.until === undefined || now < s.until)

/** Pure: the next mascot state for one main-conversation event at time `now`. */
export function nextMascot(state: Mascot, event: MascotEvent, now: number): Mascot {
  switch (event.type) {
    case 'start': return keepIdle(state)
    case 'prompt': return withMood(state, 'thinking')
    case 'tool': return without(state, ['sleeping', 'waiting', 'thinking'])
    case 'toolDone': return without(state, ['waiting'])
    case 'toolError': return withMood(state, 'error', now + FLASH_MS)
    case 'attention': return withMood(state, 'waiting', now + WAIT_MS)
    case 'turnEnd': {
      const idle = { ...without(state, ['thinking', 'waiting', 'sleeping']), idleSince: now }
      return event.isAnswer ? withMood(idle, 'happy', now + FLASH_MS) : idle
    }
    case 'idleTimeout':
      return event.idleSince === state.idleSince && !isLive(state, now) ? withMood(state, 'sleeping') : state
    case 'expire':
      return event.mood === state.mood && event.until === state.until ? keepIdle(state) : state
  }
}

/** Pure: what to draw. A live, applicable transient mood wins; otherwise the base layer. */
export function pose(state: Mascot, isWorking: boolean, now: number): Pose {
  const mood = isLive(state, now) ? state.mood : undefined
  if (mood === 'thinking' && !isWorking) return 'idle'
  if (mood === 'sleeping' && isWorking) return 'working'
  return mood ?? (isWorking ? 'working' : 'idle')
}
