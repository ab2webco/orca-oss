import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readClaudeMemberMcpInventory } from './member-mcp-inventory'

describe('readClaudeMemberMcpInventory', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-member-mcp-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const write = async (path: string, value: unknown): Promise<void> => {
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value))
  }

  it('lists user-scope servers, connected connectors, enabled plugins and the repo .mcp.json', async () => {
    const configDir = join(root, 'vault')
    const plugin = join(root, 'plugins', 'sonar')
    const repo = join(root, 'repo')
    await write(join(configDir, '.claude.json'), {
      mcpServers: { tambora: { command: 'uvx' } },
      claudeAiMcpEverConnected: ['claude.ai Gmail', 7],
      projects: { [repo]: { mcpServers: { localOnly: { command: 'x' } } } }
    })
    await write(join(configDir, 'settings.json'), {
      enabledPlugins: { 'sonar@orca': true, 'off@orca': false }
    })
    await write(join(configDir, 'plugins', 'installed_plugins.json'), {
      plugins: {
        'sonar@orca': [{ scope: 'user', installPath: plugin }],
        'off@orca': [{ scope: 'user', installPath: join(root, 'plugins', 'off') }]
      }
    })
    await write(join(plugin, '.mcp.json'), { sonar: { command: 'node' } })
    await write(join(root, 'plugins', 'off', '.mcp.json'), { off: { command: 'node' } })
    await write(join(repo, '.mcp.json'), {
      mcpServers: { plane: { command: 'plane-mcp' }, paused: { command: 'x', disabled: true } }
    })
    await write(join(repo, '.cursor', 'mcp.json'), { mcpServers: { cursorOnly: { command: 'x' } } })

    const inventory = await readClaudeMemberMcpInventory({
      configFile: join(configDir, '.claude.json'),
      configDir,
      repoPath: repo
    })

    expect(inventory).toEqual({
      servers: ['plane', 'sonar', 'tambora'],
      connectors: ['claude.ai Gmail']
    })
  })

  it('reads an absent or broken config as no servers, never as an error', async () => {
    await write(join(root, '.claude.json'), '{ not json')

    const inventory = await readClaudeMemberMcpInventory({
      configFile: join(root, '.claude.json'),
      configDir: join(root, 'missing'),
      repoPath: join(root, 'no-repo')
    })

    expect(inventory).toEqual({ servers: [], connectors: [] })
  })
})
