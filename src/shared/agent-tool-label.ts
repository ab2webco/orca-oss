const MCP_PREFIX = 'mcp__'
const PLUGIN_PREFIX = 'plugin_'

// Why: a plugin server is `plugin_<plugin>_<server>`, and most plugins name their one server after themselves.
function serverWordsOf(server: string): string {
  const parts = (server.startsWith(PLUGIN_PREFIX) ? server.slice(PLUGIN_PREFIX.length) : server)
    .split('_')
    .filter(Boolean)
  const half = parts.length / 2
  const doubled =
    Number.isInteger(half) && parts.slice(0, half).join('_') === parts.slice(half).join('_')
  return (doubled ? parts.slice(0, half) : parts).join(' ')
}

/** A tool as a person reads it: `mcp__plugin_engram_engram__mem_current_project` is `engram: mem current project`. */
export function agentToolLabelOf(toolName: string): string {
  if (!toolName.startsWith(MCP_PREFIX)) {
    return toolName
  }
  const rest = toolName.slice(MCP_PREFIX.length)
  const split = rest.lastIndexOf('__')
  const server = split > 0 ? serverWordsOf(rest.slice(0, split)) : ''
  const tool = split > 0 ? rest.slice(split + 2).replaceAll('_', ' ') : ''
  return server && tool ? `${server}: ${tool}` : toolName
}
