const MCP_PREFIX = /^mcp__[^_]+(?:_[^_]+)*?__/

/** A tool's name as words for people: `PushNotification` → `Push notification`. */
export function toolDisplayWords(tool: string): string {
  const words = tool
    .replace(MCP_PREFIX, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
  const line = words.join(' ')
  return line ? line[0]!.toUpperCase() + line.slice(1) : tool
}
