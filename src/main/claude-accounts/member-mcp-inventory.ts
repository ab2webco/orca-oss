import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inspectMcpConfigContent, MCP_CONFIG_CANDIDATES } from '../../shared/mcp-config'
import { parseEnabledPluginInstalls } from '../../shared/global-config-sync'

// Why only .mcp.json: Claude reads no other repo file for servers; .cursor/mcp.json is Cursor's.
const PROJECT_SCOPE = MCP_CONFIG_CANDIDATES.find((one) => one.relativePath === '.mcp.json')!

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readText = (path: string): Promise<string | null> => readFile(path, 'utf8').catch(() => null)

const readJson = async (path: string): Promise<unknown> => {
  const text = await readText(path)
  try {
    return text === null ? null : JSON.parse(text)
  } catch {
    return null
  }
}

const serverNamesOf = (value: unknown): string[] => (isRecord(value) ? Object.keys(value) : [])

// Why both shapes: a plugin's .mcp.json may wrap its servers in `mcpServers` or list them bare.
async function pluginServerNames(installPath: string): Promise<string[]> {
  const parsed = await readJson(join(installPath, '.mcp.json'))
  const fromMcpJson = isRecord(parsed) && isRecord(parsed.mcpServers) ? parsed.mcpServers : parsed
  const manifest = await readJson(join(installPath, '.claude-plugin', 'plugin.json'))
  return [
    ...serverNamesOf(fromMcpJson),
    ...serverNamesOf(isRecord(manifest) ? manifest.mcpServers : null)
  ]
}

/**
 * The MCP servers and claude.ai connectors a Claude started with this config would load: user scope
 * in its `.claude.json`, its enabled user plugins, and the repo's own `.mcp.json`.
 */
export async function readClaudeMemberMcpInventory(args: {
  configFile: string
  configDir: string
  repoPath: string | null
}): Promise<{ servers: string[]; connectors: string[] }> {
  const config = await readJson(args.configFile)
  const servers = serverNamesOf(isRecord(config) ? config.mcpServers : null)
  const everConnected = isRecord(config) ? config.claudeAiMcpEverConnected : null
  const connectors = Array.isArray(everConnected)
    ? everConnected.filter((one): one is string => typeof one === 'string')
    : []
  const installs = parseEnabledPluginInstalls(
    await readText(join(args.configDir, 'plugins', 'installed_plugins.json')),
    [await readText(join(args.configDir, 'settings.json'))]
  )
  for (const install of installs) {
    servers.push(...(await pluginServerNames(install.installPath)))
  }
  if (args.repoPath !== null) {
    const inspection = inspectMcpConfigContent(
      PROJECT_SCOPE,
      await readText(join(args.repoPath, PROJECT_SCOPE.relativePath))
    )
    servers.push(
      ...inspection.servers.filter((one) => one.status === 'enabled').map((one) => one.name)
    )
  }
  return { servers: [...new Set(servers)].sort(), connectors: [...new Set(connectors)].sort() }
}
