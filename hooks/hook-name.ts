import type { HookRow } from '../types'

export type RawHook = { event: string; matcher?: string; if?: string; type?: string; command?: string }

const INTERPRETERS = ['node', 'python', 'python3', 'bash', 'sh', 'zsh', 'ruby', 'pwsh']
const SHELLS = ['bash', 'sh', 'zsh']
const WRAPPERS = ['run-with-flags', 'sg-python', 'run-hook']
const SCRIPT_EXT = /\.(js|mjs|cjs|ts|py|sh|rb|ps1|cmd)$/i
const SCRIPT_LITERAL = /[\w$.{}~\\/-]*[\w-]\.(?:js|mjs|cjs|ts|py|sh|rb|ps1|cmd)\b/gi
const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/
const SAFE_SUFFIX = /^[\w:-]{1,32}$/
const INLINE = '内联命令'
// A derived name is shown always and stored: anything else falls back to INLINE.
const PLAIN_NAME = /^[\w.@+-]{1,48}( [\w:-]{1,32})?$/
// A flag whose value is a secret (displayCommand drops the value, keeps the flag).
const SECRET_FLAG = /^--?[\w-]*(?:token|secret|password|passwd|key|auth)[\w-]*$/i
const COMMAND_SEPARATORS = ['&&', '||', ';', '|', 'env']

const EVENT_LABELS: Record<string, string> = {
  PreToolUse: '工具调用前', PostToolUse: '工具调用后', UserPromptSubmit: '提交提示时',
  SessionStart: '会话开始时', SessionEnd: '会话结束时', Stop: '回合结束时', StopFailure: '回合失败时',
  Notification: '通知时', PermissionRequest: '请求权限时', PreCompact: '压缩前', SubagentStop: '子代理结束时',
  PostToolUseFailure: '工具调用失败后', PostToolBatch: '一批工具调用后', PermissionDenied: '权限被拒时', SubagentStart: '子代理开始时',
  PostCompact: '压缩后', Setup: '初始化时', ConfigChange: '配置变更时', CwdChanged: '工作目录变更时', DirectoryAdded: '添加目录时',
  FileChanged: '文件变更时', InstructionsLoaded: '加载指令时', Elicitation: 'MCP 请求输入时', ElicitationResult: 'MCP 输入返回时',
  MessageDisplay: '显示消息时', PreModelSwitch: '切换模型前', PostModelSwitch: '切换模型后', TaskCreated: '任务创建时',
  TaskCompleted: '任务完成时', TeammateIdle: '队友空闲时', UserPromptExpansion: '展开提示时', WorktreeCreate: '创建工作树时',
  WorktreeRemove: '移除工作树时',
}

export function eventLabel(event: string): string {
  return EVENT_LABELS[event] ?? event
}

// Split like a POSIX shell: single quotes are literal, double quotes honour \\ \" \$ \`, a bare backslash escapes the next character.
function tokenize(command: string): string[] {
  const words: string[] = []
  let cur = ''
  let has = false
  let i = 0
  while (i < command.length) {
    const c = command[i] as string
    if (c === "'") {
      has = true
      const end = command.indexOf("'", i + 1)
      cur += command.slice(i + 1, end < 0 ? command.length : end)
      i = end < 0 ? command.length : end + 1
    } else if (c === '"') {
      has = true
      i++
      while (i < command.length && command[i] !== '"') {
        const d = command[i] as string
        const next = command[i + 1]
        if (d === '\\' && next !== undefined && '\\"$`'.includes(next)) { cur += next; i += 2 } else { cur += d; i++ }
      }
      i++
    } else if (c === '\\' && i + 1 < command.length) {
      has = true
      cur += command[i + 1]
      i += 2
    } else if (/\s/.test(c)) {
      if (has) { words.push(cur); cur = ''; has = false }
      i++
    } else {
      has = true
      cur += c
      i++
    }
  }
  if (has) words.push(cur)
  return words
}

const baseName = (word: string): string => word.slice(word.lastIndexOf('/') + 1)
const stripExt = (file: string): string => (file.lastIndexOf('.') > 0 ? file.slice(0, file.lastIndexOf('.')) : file)
const stripPrefix = (word: string): string => word.replace(/^(?:\$\{[^}]*\}|\$[A-Za-z_]\w*|~)\//, '')
const scriptName = (word: string): string => stripExt(baseName(stripPrefix(word)))

// `-e` / `-c`; for a shell a short-flag cluster ending in `c` (`-lc`, `-ec`); for node `-p` / `--eval`.
function isInlineFlag(interpreter: string, word: string): boolean {
  if (word === '-e' || word === '-c') return true
  if (SHELLS.includes(interpreter)) return /^-[A-Za-z]*c$/.test(word)
  return interpreter === 'node' && (word === '-p' || word === '--eval')
}

// Drops leading KEY=VALUE words, then, for `<interpreter> [flags] <inline flag> <body>`, lifts the body out of the word
// list; `flag` is the inline flag's index in `words`.
function split(command: string): { words: string[]; body?: string; flag?: number } {
  const words = tokenize(command)
  while (words.length > 0 && ENV_ASSIGNMENT.test(words[0] as string)) words.shift()
  const first = words[0]
  if (first === undefined || !INTERPRETERS.includes(baseName(first))) return { words }
  for (let i = 1; i < words.length && (words[i] as string).startsWith('-'); i++) {
    if (isInlineFlag(baseName(first), words[i] as string)) {
      if (i + 1 >= words.length) return { words }
      const body = words[i + 1] as string
      return { words: [...words.slice(0, i + 1), ...words.slice(i + 2)], body, flag: i }
    }
  }
  return { words }
}

function analyze(command: string): { name: string; tail: string[] } {
  const found = derive(command)
  return PLAIN_NAME.test(found.name) ? found : { name: INLINE, tail: found.tail }
}

function derive(command: string): { name: string; tail: string[] } {
  const { words: raw, body, flag } = split(command)
  const words = raw.map(stripPrefix)
  let script = -1
  words.forEach((w, i) => {
    if (!w.startsWith('-') && !/[\s=]/.test(w) && (SCRIPT_EXT.test(w) || (i === 0 && w.includes('/')))) script = i
  })
  if (script >= 0) {
    const name = stripExt(baseName(words[script] as string))
    const tail = words.slice(script + 1)
    if (WRAPPERS.includes(name)) return { name: tail[0] !== undefined && SAFE_SUFFIX.test(tail[0]) ? `${name} ${tail[0]}` : name, tail }
    return { name, tail }
  }
  // The inline flag is not an argument: its body is gone, so it must not count as the flag before the next word.
  const tail = words.slice(1).filter((_, i) => i + 1 !== flag)
  const literals = body?.match(SCRIPT_LITERAL)
  const last = literals?.[literals.length - 1]
  if (last !== undefined) return { name: scriptName(last), tail }
  // Colon identifiers: skip any flag's argument (it may be a credential) and anything ending in a bare number (host:port).
  const ident = words.find((w, i) => !w.startsWith('-') && !(words[i - 1] ?? '').startsWith('-') && /^[\w-]+(?::[\w-]+)+$/.test(w) && !/^\d+$/.test(w.slice(w.lastIndexOf(':') + 1)))
  if (ident !== undefined) return { name: ident.slice(ident.lastIndexOf(':') + 1), tail }
  return { name: INLINE, tail }
}

export function hookName(command: string): string {
  return analyze(command).name
}

const quoteIfNeeded = (word: string): string => (word === '' || /\s/.test(word) ? `"${word.replace(/(["\\$`])/g, '\\$1')}"` : word)

export function displayCommand(command: string): string {
  const { words } = split(command)
  const kept: string[] = []
  // KEY=VALUE words before a command's first other word are dropped; a separator or `env` starts a command again.
  let atStart = true
  // The base name of the current command's first word: `-u` / `--user` is a credential only for curl and wget.
  let program = ''
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string
    if (atStart && ENV_ASSIGNMENT.test(w)) continue
    if (atStart && !COMMAND_SEPARATORS.includes(w)) program = baseName(w)
    atStart = COMMAND_SEPARATORS.includes(w)
    const isFetch = program === 'curl' || program === 'wget'
    if (w === '-H' || w === '--header' || (isFetch && (w === '-u' || w === '--user'))) { i++; continue }
    if (w.startsWith('--header=') || (isFetch && (w.startsWith('--user=') || /^-u./.test(w)))) continue
    const eq = w.indexOf('=')
    if (w.startsWith('-') && SECRET_FLAG.test(eq < 0 ? w : w.slice(0, eq))) {
      kept.push(eq < 0 ? w : w.slice(0, eq))
      if (eq < 0) i++
      continue
    }
    // A URL loses its query string and any `user[:pass]@` before the host.
    const url = (u: string): string => u.replace(/\?.*$/, '').replace(/^(https?:\/\/)[^/@]*@/i, '$1')
    kept.push(quoteIfNeeded(/^https?:\/\//i.test(w) ? url(w) : w))
  }
  return kept.join(' ').slice(0, 200)
}

export function toRows(entries: RawHook[]): HookRow[] {
  const items = entries.map((e, index) => {
    const isCommandless = e.type !== undefined && e.type !== 'command'
    const { name, tail } = isCommandless ? { name: `${e.type} 钩子`, tail: [] as string[] } : analyze(e.command ?? '')
    const key = (n: string): string => JSON.stringify([e.event, e.matcher || '', e.if ?? '', n])
    return { e, index, name, tail, key }
  })

  // Rows of one group that still look the same get the first trailing argument that tells them apart, if it is short and plain.
  const groups = new Map<string, typeof items>()
  for (const it of items) {
    const k = it.key(it.name)
    groups.set(k, [...(groups.get(k) ?? []), it])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const width = Math.max(...group.map(g => g.tail.length))
    for (let p = 0; p < width; p++) {
      const values = group.map(g => g.tail[p])
      if (values.every(v => v === values[0])) continue
      // A value right after a flag may be that flag's argument (a token): never a suffix.
      const isFlagValue = group.some(g => (g.tail[p - 1] ?? '').startsWith('-'))
      if (!isFlagValue && values.every(v => v !== undefined && SAFE_SUFFIX.test(v))) group.forEach((g, i) => { g.name += ` ${values[i]}` })
      break
    }
  }
  // Whatever still collides is numbered from the second row on.
  const seen = new Map<string, number>()
  for (const it of items) {
    const k = it.key(it.name)
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    if (n > 1) it.name += ` #${n}`
  }

  return items.map(({ e, index, name }) => {
    const label = eventLabel(e.event)
    const what = e.matcher
      ? `${label}（匹配 ${e.matcher}）${label.endsWith('时') ? '' : '时'}运行 ${name}`
      : `${label}运行 ${name}`
    const row: HookRow = { event: e.event, name, what, index }
    if (e.matcher) row.matcher = e.matcher
    if (e.if !== undefined) row.condition = e.if
    return row
  })
}
