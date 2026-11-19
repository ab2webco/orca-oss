import { describe, expect, it } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import { SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV } from '../../shared/setup-agent-sequencing'
import {
  ConversationRestores,
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

function deps(args: {
  statuses: AgentStatusIpcPayload[]
  bound?: Record<string, string>
  persisted?: Record<string, string>
  live: Record<string, boolean | null>
  now?: () => number
}): ConversationHolderDeps & { probed: string[] } {
  const probed: string[] = []
  return {
    probed,
    statuses: () => args.statuses,
    boundPtyIdOf: (paneKey) => args.bound?.[paneKey],
    persistedPtyIdOf: (paneKey) => args.persisted?.[paneKey],
    runsAgent: async (ptyId) => {
      probed.push(ptyId)
      return args.live[ptyId] ?? false
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
      live: { 'pty-lead': true }
    })

    await expect(paneHoldingConversation(holder, ASK)).resolves.toBe('tab-lead:leaf')
  })

  it('never counts the restoring pane or its own PTY', async () => {
    const holder = deps({
      statuses: [status('tab-new:leaf'), status('tab-alias:leaf')],
      persisted: { 'tab-new:leaf': 'pty-new', 'tab-alias:leaf': 'pty-new' },
      live: { 'pty-new': true }
    })

    await expect(paneHoldingConversation(holder, ASK)).resolves.toBeNull()
  })

  it('keeps the resume when liveness is unknown or the PTY is gone', async () => {
    const holder = deps({
      statuses: [status('tab-a:leaf'), status('tab-b:leaf'), status('tab-c:leaf')],
      persisted: { 'tab-a:leaf': 'pty-a', 'tab-b:leaf': 'pty-b' },
      live: { 'pty-a': null, 'pty-b': false }
    })

    await expect(paneHoldingConversation(holder, ASK)).resolves.toBeNull()
  })

  it("reads the pane's PTY in this run before the one it was saved with", async () => {
    const holder = deps({
      statuses: [status('tab-lead:leaf')],
      bound: { 'tab-lead:leaf': 'pty-now' },
      persisted: { 'tab-lead:leaf': 'pty-saved' },
      live: { 'pty-now': true }
    })

    await expect(paneHoldingConversation(holder, ASK)).resolves.toBe('tab-lead:leaf')
    expect(holder.probed).toEqual(['pty-now'])
  })

  it('ignores a live pane on another conversation or another agent', async () => {
    const holder = deps({
      statuses: [status('tab-a:leaf', 'sess-other'), status('tab-b:leaf', 'sess-lead', 'codex')],
      persisted: { 'tab-a:leaf': 'pty-a', 'tab-b:leaf': 'pty-b' },
      live: { 'pty-a': true, 'pty-b': true }
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
      live: { 'pty-lead': false }
    })

    await expect(paneHoldingConversation(holder, ASK)).resolves.toBeNull()
  })

  it('never counts the same session id reported from another host', async () => {
    const holder = deps({
      statuses: [status('tab-lead:leaf', 'sess-lead', 'claude', 'ssh-1')],
      persisted: { 'tab-lead:leaf': 'pty-lead' },
      live: { 'pty-lead': true }
    })

    await expect(paneHoldingConversation(holder, ASK)).resolves.toBeNull()
    await expect(paneHoldingConversation(holder, { ...ASK, connectionId: 'ssh-1' })).resolves.toBe(
      'tab-lead:leaf'
    )
  })
})

describe('ConversationRestores', () => {
  const PANE_A = { ...ASK, paneKey: 'tab-a:leaf', ptyId: 'pty-a' }
  const PANE_B = { ...ASK, paneKey: 'tab-b:leaf', ptyId: 'pty-b' }

  it('lets the first of two restores resume and names it to the second', async () => {
    const restores = new ConversationRestores(deps({ statuses: [], live: {} }))

    await expect(Promise.all([restores.admit(PANE_A), restores.admit(PANE_B)])).resolves.toEqual([
      null,
      'tab-a:leaf'
    ])
  })

  it('lets the same pane resume again, as a retry of its own restore', async () => {
    const restores = new ConversationRestores(deps({ statuses: [], live: {} }))
    await restores.admit(PANE_A)

    await expect(restores.admit(PANE_A)).resolves.toBeNull()
  })

  it('frees the conversation once the claimed pane no longer runs the agent', async () => {
    let clock = 0
    const live: Record<string, boolean | null> = { 'pty-a': true }
    const restores = new ConversationRestores(deps({ statuses: [], live, now: () => clock }))
    await restores.admit(PANE_A)

    clock = 60_000
    await expect(restores.admit(PANE_B)).resolves.toBe('tab-a:leaf')
    live['pty-a'] = false
    await expect(restores.admit(PANE_B)).resolves.toBeNull()
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
