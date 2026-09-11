import { describe, expect, it } from 'vitest'
import type { SleepingAgentLaunchConfig } from '../../shared/agent-session-resume'
import {
  resolveClaudeTerminalSwitchReadiness,
  type ClaudeTerminalSwitchPreflight
} from './claude-terminal-switch-readiness'

const LAUNCH_CONFIG: SleepingAgentLaunchConfig = {
  agentCommand: 'claude',
  agentArgs: '',
  agentEnv: {}
}

function preflight(
  overrides: Partial<ClaudeTerminalSwitchPreflight> = {}
): ClaudeTerminalSwitchPreflight {
  return {
    servicesAttached: true,
    paneResolved: true,
    isWsl: false,
    remoteConnectionId: null,
    cwd: '/repo',
    sourceAccountId: 'account-1',
    providerSessionId: 'session-1',
    sessionTranscriptPresent: true,
    launchConfig: LAUNCH_CONFIG,
    ...overrides
  }
}

describe('resolveClaudeTerminalSwitchReadiness', () => {
  it('reports a fully bound pane as ready', () => {
    expect(resolveClaudeTerminalSwitchReadiness(preflight())).toEqual({ state: 'ready' })
  })

  // Measured twice on a real remote host: a Claude session that has just
  // started has no transcript file yet. The readiness used to call it ready, so
  // the menu offered the switch, the transaction began, and the copy failed
  // mid-flight with a message that read like the session had been lost.
  it('refuses a session that has no saved conversation yet, before anything starts', () => {
    expect(
      resolveClaudeTerminalSwitchReadiness(preflight({ sessionTranscriptPresent: false }))
    ).toEqual({ state: 'unavailable', reason: 'transcript-unavailable' })
  })

  // The other half, and the one that would hurt more if it broke: a session that
  // DOES have a transcript must stay switchable. Every uncertainty upstream
  // resolves to `true` precisely so a probe that cannot answer never refuses.
  it('stays ready when the transcript is present', () => {
    expect(
      resolveClaudeTerminalSwitchReadiness(preflight({ sessionTranscriptPresent: true }))
    ).toEqual({ state: 'ready' })
  })

  // ORCA-187: the state a restored pane lands in — every other prerequisite
  // survived the restart, only the launch description did not.
  it('names the launch config when that is the only thing missing', () => {
    expect(resolveClaudeTerminalSwitchReadiness(preflight({ launchConfig: null }))).toEqual({
      state: 'unavailable',
      reason: 'missing-launch-config'
    })
  })

  it('treats a launch config with no command as no launch config', () => {
    expect(
      resolveClaudeTerminalSwitchReadiness(
        preflight({ launchConfig: { agentCommand: '   ', agentArgs: '', agentEnv: {} } })
      )
    ).toEqual({ state: 'unavailable', reason: 'missing-launch-config' })
  })

  it.each([
    ['runtime-unavailable', { servicesAttached: false }],
    ['terminal-not-found', { paneResolved: false }],
    ['unsupported-runtime', { isWsl: true }],
    ['unsupported-runtime', { remoteConnectionId: 'ssh-1' }],
    ['workspace-unresolved', { cwd: null }],
    ['source-unknown', { sourceAccountId: null }],
    ['missing-session', { providerSessionId: null }]
  ] as const)('reports %s', (reason, overrides) => {
    expect(resolveClaudeTerminalSwitchReadiness(preflight(overrides))).toEqual({
      state: 'unavailable',
      reason
    })
  })

  // Why order is asserted: the report and the switch must name the SAME first
  // failure, or a pane reads as unswitchable for a reason it does not have.
  it('reports the first unmet prerequisite, not the last', () => {
    expect(
      resolveClaudeTerminalSwitchReadiness(
        preflight({ cwd: null, sourceAccountId: null, launchConfig: null })
      )
    ).toEqual({ state: 'unavailable', reason: 'workspace-unresolved' })
  })

  // ORCA-195: the transcript is copied two steps later, so no unmet prerequisite
  // here may borrow its reason.
  it('never names the transcript for a prerequisite the switch checks before it', () => {
    const reasons = (
      [
        { servicesAttached: false },
        { paneResolved: false },
        { isWsl: true },
        { remoteConnectionId: 'ssh-1' },
        { cwd: null },
        { sourceAccountId: null },
        { providerSessionId: null },
        { launchConfig: null }
      ] as const
    ).map((overrides) => resolveClaudeTerminalSwitchReadiness(preflight(overrides)))
    expect(reasons).not.toContainEqual({
      state: 'unavailable',
      reason: 'transcript-unavailable'
    })
  })
})
