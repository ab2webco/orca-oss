import { describe, expect, it } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import { SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV } from '../../shared/setup-agent-sequencing'
import {
  ConversationRestores,
  foregroundRunsAgent,
  paneHoldingConversation,
  withoutSequencedStartupCommand,
  type ConversationHolderDeps
} from './pty-conversation-held-elsewhere'

const SESSION = { key: 'session_id' as const, id: 'sess-lead' }

const status = (
  paneKey: string,
  id = 'sess-lead',
  agentType = 'claude',
  connectionId: string | null = null
) =>
  ({
    paneKey,
    agentType,
    state: 'working',
    providerSession: { key: 'session_id', id },
    connectionId,
    receivedAt: 1,
    stateStartedAt: 1
  }) as AgentStatusIpcPayload

/** `foregrounds` is what each live PTY runs in front; a PTY left out is gone. */
function deps(args: {
  statuses: AgentStatusIpcPayload[]
  bound?: Record<string, string>
  persisted?: Record<string, string>
  foregrounds: Record<string, string | null>
  now?: () => number
}): ConversationHolderDeps & { probed: string[] } {
  const probed: string[] = []
  return {
    probed,
    statuses: () => args.statuses,
    boundPtyIdOf: (paneKey) => args.bound?.[paneKey],
    persistedPtyIdOf: (paneKey) => args.persisted?.[paneKey],
    foregroundOf: async (ptyId) => {
      probed.push(ptyId)
      return args.foregrounds[ptyId] ?? null
    },
    ...(args.now ? { now: args.now } : {})
  }
}

const ASK = {
  agent: 'claude',
  providerSession: SESSION,
  connectionId: null,
  paneKey: 'tab-new:leaf',
  ptyId: 'pty-new'
}

describe('paneHoldingConversation', () => {
  it('names the other pane whose live PTY runs the conversation', async () => {
    const holder = deps({
      statuses: [status('tab-new:leaf'), status('tab-lead:leaf')],
      persisted: { 'tab-lead:leaf': 'pty-lead' },
      foregrounds: { 'pty-lead': 'claude' }
    })

    await expect(paneHoldingConversation(holder, ASK)).resolves.toBe('tab-lead:leaf')
  })

  it('never counts the restoring pane or its own PTY', async () => {
    const holder = deps({
      statuses: [status('tab-new:leaf'), status('tab-alias:leaf')],
      persisted: { 'tab-new:leaf': 'pty-new', 'tab-alias:leaf': 'pty-new' },
      foregrounds: { 'pty-new': 'claude' }
    })

    await expect(paneHoldingConversation(holder, ASK)).resolves.toBeNull()
  })

  it('keeps the resume when liveness is unknown or the PTY is gone', async () => {
    const holder = deps({
      statuses: [status('tab-a:leaf'), status('tab-b:leaf'), status('tab-c:leaf')],
      persisted: { 'tab-a:leaf': 'pty-a', 'tab-b:leaf': 'pty-b' },
      foregrounds: { 'pty-a': null }
    })

    await expect(paneHoldingConversation(holder, ASK)).resolves.toBeNull()
  })

  it("reads the pane's PTY in this run before the one it was saved with", async () => {
    const holder = deps({
      statuses: [status('tab-lead:leaf')],
      bound: { 'tab-lead:leaf': 'pty-now' },
      persisted: { 'tab-lead:leaf': 'pty-saved' },
      foregrounds: { 'pty-now': 'claude' }
    })

    await expect(paneHoldingConversation(holder, ASK)).resolves.toBe('tab-lead:leaf')
    expect(holder.probed).toEqual(['pty-now'])
  })

  it('ignores a live pane on another conversation or another agent', async () => {
    const holder = deps({
      statuses: [status('tab-a:leaf', 'sess-other'), status('tab-b:leaf', 'sess-lead', 'codex')],
      persisted: { 'tab-a:leaf': 'pty-a', 'tab-b:leaf': 'pty-b' },
      foregrounds: { 'pty-a': 'claude', 'pty-b': 'codex' }
    })

    await expect(paneHoldingConversation(holder, ASK)).resolves.toBeNull()
  })
})

describe('paneHoldingConversation: which pane holds it', () => {
  // Why (ORCA-1283 review): a status row outlives an agent that exited to its shell.
  it('never counts a pane whose agent is no longer in front of its shell', async () => {
    const holder = deps({
      statuses: [status('tab-lead:leaf')],
      persisted: { 'tab-lead:leaf': 'pty-lead' },
      foregrounds: { 'pty-lead': 'zsh' }
    })

    await expect(paneHoldingConversation(holder, ASK)).resolves.toBeNull()
  })

  it('never counts the same session id reported from another host', async () => {
    const holder = deps({
      statuses: [status('tab-lead:leaf', 'sess-lead', 'claude', 'ssh-1')],
      persisted: { 'tab-lead:leaf': 'pty-lead' },
      foregrounds: { 'pty-lead': 'claude' }
    })

    await expect(paneHoldingConversation(holder, ASK)).resolves.toBeNull()
    await expect(paneHoldingConversation(holder, { ...ASK, connectionId: 'ssh-1' })).resolves.toBe(
      'tab-lead:leaf'
    )
  })
})

describe('foregroundRunsAgent', () => {
  it('matches Claude by its name, the Agent Teams wrapper and its native binary', () => {
    for (const foreground of ['claude', '2.1.328']) {
      expect(foregroundRunsAgent('claude', foreground)).toBe(true)
    }
    expect(foregroundRunsAgent('codex', 'codex')).toBe(true)
  })

  // Why: after the agent exits the pane can run anything, and a WSL pane shows wsl.exe in front.
  it('never matches another program, a shell, WSL, or an unknown foreground', () => {
    for (const foreground of ['vim', 'npm', 'node', 'ssh', 'zsh', 'wsl.exe', null]) {
      expect(foregroundRunsAgent('claude', foreground)).toBe(false)
    }
    expect(foregroundRunsAgent('codex', 'claude')).toBe(false)
  })
})

describe('ConversationRestores', () => {
  const PANE_A = { ...ASK, paneKey: 'tab-a:leaf', ptyId: 'pty-a' }
  const PANE_B = { ...ASK, paneKey: 'tab-b:leaf', ptyId: 'pty-b' }

  it('lets the first of two restores resume and names it to the second', async () => {
    const restores = new ConversationRestores(deps({ statuses: [], foregrounds: {} }))

    const [first, second] = await Promise.all([restores.admit(PANE_A), restores.admit(PANE_B)])

    expect([first.heldBy, second.heldBy]).toEqual([null, 'tab-a:leaf'])
  })

  it('lets the same pane resume again, as a retry of its own restore', async () => {
    const restores = new ConversationRestores(deps({ statuses: [], foregrounds: {} }))
    await restores.admit(PANE_A)

    await expect(restores.admit(PANE_A)).resolves.toMatchObject({ heldBy: null })
  })

  it('frees the conversation once the claimed pane no longer runs the agent', async () => {
    let clock = 0
    const foregrounds: Record<string, string | null> = { 'pty-a': 'claude' }
    const restores = new ConversationRestores(deps({ statuses: [], foregrounds, now: () => clock }))
    ;(await restores.admit(PANE_A)).settle('pty-a')

    clock = 60_000
    await expect(restores.admit(PANE_B)).resolves.toMatchObject({ heldBy: 'tab-a:leaf' })
    foregrounds['pty-a'] = 'vim'
    await expect(restores.admit(PANE_B)).resolves.toMatchObject({ heldBy: null })
  })

  // Why (ORCA-1283 review): a failed first spawn must not leave the conversation running nowhere.
  it('frees the conversation at once when the claimed spawn fails', async () => {
    const restores = new ConversationRestores(deps({ statuses: [], foregrounds: {} }))
    ;(await restores.admit(PANE_A)).settle(null)

    await expect(restores.admit(PANE_B)).resolves.toMatchObject({ heldBy: null })
  })

  it('frees the conversation when the restored pane closes', async () => {
    let clock = 0
    const restores = new ConversationRestores(
      deps({ statuses: [], foregrounds: {}, now: () => clock })
    )
    ;(await restores.admit(PANE_A)).settle('pty-a')

    clock = 1_000
    await expect(restores.admit(PANE_B)).resolves.toMatchObject({ heldBy: null })
  })

  it('claims nothing for a restore it cannot tell apart, so its retry is never blocked', async () => {
    const restores = new ConversationRestores(deps({ statuses: [], foregrounds: {} }))
    const anonymous = { ...ASK, paneKey: null, ptyId: undefined }
    await restores.admit(anonymous)

    await expect(restores.admit(anonymous)).resolves.toMatchObject({ heldBy: null })
    await expect(restores.admit(PANE_B)).resolves.toMatchObject({ heldBy: null })
  })

  it('keeps no claim or queue once nothing holds the conversation', async () => {
    const restores = new ConversationRestores(deps({ statuses: [], foregrounds: {} }))
    ;(await restores.admit(PANE_A)).settle(null)
    await new Promise((done) => setTimeout(done, 0))

    const maps = restores as unknown as {
      claims: Map<string, unknown>
      queues: Map<string, unknown>
    }
    expect([maps.claims.size, maps.queues.size]).toEqual([0, 0])
  })
})

describe('withoutSequencedStartupCommand', () => {
  it('drops only the sequenced startup line', () => {
    expect(
      withoutSequencedStartupCommand({
        [SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV]: "claude --resume 'sess-lead'",
        ORCA_PANE_KEY: 'tab-new:leaf'
      })
    ).toEqual({ ORCA_PANE_KEY: 'tab-new:leaf' })
  })
})
