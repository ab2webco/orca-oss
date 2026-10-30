import { describe, expect, it } from 'vitest'
import { missingGameMcpServersOf } from './orchestrator-game-member-mcp'
import { parseGameLead } from './orchestrator-game-lead'

describe('missingGameMcpServersOf', () => {
  it('matches names case-insensitively and lets a claude.ai connector cover its bare name', () => {
    const inventory = { servers: ['Tambora'], connectors: ['claude.ai Google Drive'] }

    expect(
      missingGameMcpServersOf(['tambora', 'google drive', 'claude.ai Google Drive'], inventory)
    ).toEqual([])
    expect(missingGameMcpServersOf(['plane', 'tambora'], inventory)).toEqual(['plane'])
  })
})

describe('orchestratorGame.orchestrator.mcpServers', () => {
  it('keeps a list of names, once each', () => {
    expect(parseGameLead({ mcpServers: ['tambora', ' plane ', 'tambora'] })).toEqual({
      value: { mcpServers: ['tambora', 'plane'] },
      warnings: []
    })
  })

  it('drops anything but a non-empty list of names, with a warning', () => {
    for (const raw of ['tambora', [], ['tambora', ''], [3]]) {
      expect(parseGameLead({ mcpServers: raw })).toEqual({
        value: {},
        warnings: [
          'orchestratorGame.orchestrator.mcpServers must be a list of 1 to 20 MCP server names'
        ]
      })
    }
  })
})
