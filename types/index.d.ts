export type View = 'claudemd' | 'mcp' | 'hooks' | 'settings' | 'file'
export type Mode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions' | 'dontAsk'
export type ModeState = { value: string; isConfirmed: boolean }   // value may be a string outside Mode; isConfirmed = a classic event confirmed it
export type Dynamic = {
  model?: string; project?: string; branch?: string; isDirty?: boolean
  contextPercent?: number; contextTokens?: number; contextWindow?: number
  usagePercent?: number; usageResetsAt?: string
  weekPercent?: number; weekResetsAt?: string
}
export type MemoryFile = { path: string; type: string; tokens: number }
export type SettingsLevel = 'user' | 'project' | 'local'
export type SettingsFile = { path: string; level: SettingsLevel }
export type McpTool = { name: string; description?: string; isLoaded: boolean }
export type McpServer = { id: string; name: string; plugin?: string; what: string; tokens: number; tools: McpTool[] }
export type HookRow = { event: string; matcher?: string; condition?: string; name: string; what: string; index: number }
export type HookGroup = { id: string; label: string; description?: string; file?: string; rows: HookRow[] }
export type Mood = 'thinking' | 'happy' | 'error' | 'waiting' | 'sleeping'
export type Mascot = { mood?: Mood; until?: number; idleSince?: number }
export type Ui = { view: View; filePath?: string; fileRev?: number; serverId?: string; openGroups: string[]; openHook?: { group: string; index: number } }

declare module 'claude-code' {
  interface PluginState {
    'code-hud': {
      dynamic: Shaped<Dynamic>; memory: Shaped<MemoryFile[]>; servers: Shaped<McpServer[]>
      hooks: Shaped<HookGroup[]>; settings: Shaped<SettingsFile[]>; mode: Shaped<ModeState> | null; mascot: Shaped<Mascot>; ui: Shaped<Ui>
    }
  }
}
