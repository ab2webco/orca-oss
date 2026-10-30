/** The MCP servers a member's agent and account would load on its host, or why they could not be read. */
export type GameMemberMcpInventory =
  | {
      checked: true
      servers: string[]
      /** claude.ai connectors the account has connected, as Claude names them (`claude.ai Gmail`). */
      connectors: string[]
      /** The account the host read, when the host picked it (`--on` with `auto` or an email). */
      account?: string
    }
  | { checked: false; reason: string }

export const GAME_MCP_SERVER_NAME_MAX = 80

const CONNECTOR_PREFIX = 'claude.ai '

const keyOf = (name: string): string => name.trim().toLowerCase()

/** The required names the inventory lacks; a connector `claude.ai X` satisfies `X` too. */
export function missingGameMcpServersOf(
  required: readonly string[],
  inventory: { servers: readonly string[]; connectors: readonly string[] }
): string[] {
  const present = new Set(inventory.servers.map(keyOf))
  for (const connector of inventory.connectors) {
    const key = keyOf(connector)
    present.add(key)
    if (key.startsWith(CONNECTOR_PREFIX)) {
      present.add(key.slice(CONNECTOR_PREFIX.length))
    }
  }
  return required.filter((name) => !present.has(keyOf(name)))
}

/** Why the launch is refused, naming each missing server, where it was looked for, and the ways on. */
export function gameMcpServersMissingText(args: {
  ticket: string
  missing: readonly string[]
  where: string
  inventory: { servers: readonly string[]; connectors: readonly string[] }
}): string {
  const has = [...args.inventory.servers, ...args.inventory.connectors]
  const plural = args.missing.length > 1
  return `${args.ticket}: ${args.where} has no MCP server ${args.missing.join(', ')}, which ${plural ? 'are' : 'is'} in orchestratorGame.orchestrator.mcpServers (it has ${has.length > 0 ? has.join(', ') : 'none'}). Add ${plural ? 'them' : 'it'} there, launch on another --account or --on, or pass --skip-mcp-check.`
}
