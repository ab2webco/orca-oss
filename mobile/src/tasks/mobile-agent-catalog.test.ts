import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { MOBILE_AGENT_CATALOG } from './mobile-agent-catalog'
import { MOBILE_TUI_AGENT_AUTO_PICK_ORDER } from './mobile-tui-agents'

const currentDir = import.meta.dirname

function readDesktopSharedFile(relativePath: string): string {
  return readFileSync(resolve(currentDir, '../../../src/shared', relativePath), 'utf8')
}

function parseDesktopAutoPickOrder(): string[] {
  const source = readDesktopSharedFile('tui-agent-selection.ts')
  const match = source.match(/TUI_AGENT_AUTO_PICK_ORDER = \[([\s\S]*?)\] as const/)
  expect(match).not.toBeNull()
  return Array.from(match?.[1].matchAll(/'([^']+)'/g) ?? [], (entry) => entry[1])
}

function parseDesktopConfiguredAgents(): string[] {
  const source = readDesktopSharedFile('tui-agent-config.ts')
  const match = source.match(/TUI_AGENT_CONFIG: Record<TuiAgent, TuiAgentConfig> = {([\s\S]*?)^}/m)
  expect(match).not.toBeNull()
  return Array.from(
    match?.[1].matchAll(/^  (?:'([^']+)'|([a-z][a-z0-9-]*)): {/gm) ?? [],
    (entry) => entry[1] ?? entry[2]
  )
}

// Why an allowlist instead of set equality: desktop keeps recognition/resume
// plumbing in TUI_AGENT_CONFIG for agents retired from every selection surface,
// so a configured agent is not automatically a launchable one. claude-zai is
// retired (z.ai/GLM now runs through the regular claude CLI via a managed
// custom-endpoint account) but stays configured so pre-existing sessions resume.
// Listing the exceptions keeps this strict: a NEW omission still fails.
const DESKTOP_RECOGNITION_ONLY_AGENTS = ['claude-zai']

describe('mobile agent catalog', () => {
  it('stays in the same order as desktop auto-pick and covers every configured TUI agent', () => {
    const desktopAutoPickOrder = parseDesktopAutoPickOrder()
    expect(MOBILE_TUI_AGENT_AUTO_PICK_ORDER).toEqual(desktopAutoPickOrder)
    expect(MOBILE_AGENT_CATALOG.map((agent) => agent.id)).toEqual(desktopAutoPickOrder)
    const cataloged = new Set(MOBILE_AGENT_CATALOG.map((agent) => agent.id))
    const configured = parseDesktopConfiguredAgents()
    expect(configured.filter((agent) => !cataloged.has(agent))).toEqual(
      DESKTOP_RECOGNITION_ONLY_AGENTS
    )
    expect([...cataloged].filter((agent) => !configured.includes(agent))).toEqual([])
  })

  it('uses the bundled Claude icon path for Claude Agent Teams', () => {
    expect(MOBILE_AGENT_CATALOG.find((agent) => agent.id === 'claude-agent-teams')).toEqual(
      expect.not.objectContaining({ faviconDomain: expect.any(String) })
    )
  })
})
