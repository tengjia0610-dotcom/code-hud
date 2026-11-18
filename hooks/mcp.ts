import type { McpServer, McpTool } from '../types'

const UUID = /^([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseServer(serverName: string): { name: string; plugin?: string } {
  const uuid = UUID.exec(serverName)
  if (uuid) return { name: `连接器 ${uuid[1]}` }
  const parts = serverName.split(':')
  if (parts[0] === 'plugin' && parts.length >= 3 && parts[1]) {
    return { name: parts.slice(2).join(':'), plugin: parts[1] }
  }
  return { name: serverName }
}

function toolDisplayName(name: string): string {
  const i = name.lastIndexOf('__')
  const short = i >= 0 ? name.slice(i + 2) : name
  return short || name
}

function firstSentence(text: string | undefined): string | undefined {
  const t = (text ?? '').trim()
  if (!t) return undefined
  const m = /^[\s\S]*?[.。!?](?=\s|$)/.exec(t)
  return (m ? m[0] : t.split(/\r?\n/)[0] ?? t).trim() || undefined
}

export function groupServers(
  tools: { name: string; serverName: string; tokens: number; isLoaded: boolean }[],
  infos: { name: string; description?: string }[],
  pluginDescriptions: Record<string, string>,
): McpServer[] {
  const descriptions = new Map(infos.map(i => [i.name, i.description]))
  const byServer = new Map<string, typeof tools>()
  for (const t of tools) {
    const list = byServer.get(t.serverName)
    if (list) list.push(t)
    else byServer.set(t.serverName, [t])
  }
  const servers: McpServer[] = []
  for (const [id, list] of byServer) {
    const { name, plugin } = parseServer(id)
    const rows: McpTool[] = list.map(t => {
      const row: McpTool = { name: toolDisplayName(t.name), isLoaded: t.isLoaded }
      const description = firstSentence(descriptions.get(t.name))
      if (description) row.description = description
      return row
    })
    const names = rows.map(r => r.name)
    const d = plugin !== undefined && Object.hasOwn(pluginDescriptions, plugin) ? pluginDescriptions[plugin] : undefined
    const pluginWhat = typeof d === 'string' ? d.trim() : undefined
    const what = pluginWhat
      || (names.length > 3
        ? `提供 ${names.slice(0, 3).join('、')} 等 ${names.length} 个工具`
        : `提供 ${names.join('、')} 共 ${names.length} 个工具`)
    const server: McpServer = { id, name, what, tokens: list.reduce((n, t) => n + t.tokens, 0), tools: rows }
    if (plugin) server.plugin = plugin
    servers.push(server)
  }
  return servers.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
