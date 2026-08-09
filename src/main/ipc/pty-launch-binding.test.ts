import { describe, expect, it } from 'vitest'
import type { SleepingAgentLaunchConfig } from '../../shared/agent-session-resume'
import { resolveRegisteredPtyLaunchBinding } from './pty-launch-binding'

// ORCA-187: a restart-restore reattaches the surviving PTY, and the launch
// description main needs to relaunch it under another account used to ride the
// same `&&` as the launch token main must never accept from a reattach.

const LAUNCH_CONFIG: SleepingAgentLaunchConfig = {
  agentCommand: 'claude',
  agentArgs: '--permission-mode acceptEdits',
  agentEnv: { ORCA_AGENT: 'claude' }
}

describe('resolveRegisteredPtyLaunchBinding', () => {
  it('keeps a reattached pane its launch description', () => {
    expect(
      resolveRegisteredPtyLaunchBinding({
        isReattach: true,
        launchConfig: LAUNCH_CONFIG,
        launchAgent: 'claude'
      })
    ).toEqual({ launchConfig: LAUNCH_CONFIG, launchAgent: 'claude' })
  })

  it('never binds a launch token to a reattached pane, however trusted it looks', () => {
    // The renderer mints this token for the fallback spawn it may never make;
    // the already-running child was born with a different one. Binding it would
    // hand a process an orchestration identity it cannot prove.
    const binding = resolveRegisteredPtyLaunchBinding({
      isReattach: true,
      launchConfig: LAUNCH_CONFIG,
      trustedLaunchToken: 'freshly-minted-token',
      launchAgent: 'claude'
    })

    expect(binding.launchToken).toBeUndefined()
    expect(binding.launchConfig).toEqual(LAUNCH_CONFIG)
  })

  it('binds both on a fresh spawn, whose token main watched the child receive', () => {
    expect(
      resolveRegisteredPtyLaunchBinding({
        isReattach: false,
        launchConfig: LAUNCH_CONFIG,
        trustedLaunchToken: 'proven-token',
        launchAgent: 'claude'
      })
    ).toEqual({
      launchConfig: LAUNCH_CONFIG,
      launchToken: 'proven-token',
      launchAgent: 'claude'
    })
  })

  it('binds nothing when a fresh spawn could not prove its token', () => {
    expect(
      resolveRegisteredPtyLaunchBinding({ isReattach: false, launchConfig: LAUNCH_CONFIG })
    ).toEqual({})
  })

  it('binds nothing when the spawn carried no launch description at all', () => {
    expect(
      resolveRegisteredPtyLaunchBinding({ isReattach: true, trustedLaunchToken: 'token' })
    ).toEqual({})
  })
})
