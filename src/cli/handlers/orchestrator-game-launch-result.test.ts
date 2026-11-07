import { describe, expect, it } from 'vitest'
import { formatGameLaunch, type GameLaunchResult } from './orchestrator-game-launch-result'

const launched: GameLaunchResult = {
  ticket: 'ORCA-7',
  name: 'Kael',
  agent: 'claude',
  runId: 'run_1',
  taskId: 'task_1',
  dispatchId: 'ctx_1',
  state: 'ready'
}

describe('formatGameLaunch nesting warning (ORCA-1116)', () => {
  it('says why a member is not under the lead', () => {
    const text = formatGameLaunch({
      ...launched,
      effects: [
        { action: 'reused' },
        {
          action: 'lineage_unresolved',
          warning:
            "Not nested under the lead's worktree: Worktree instance identity was unavailable."
        }
      ]
    })

    expect(text).toBe(
      'ORCA-7 (Kael): member ctx_1 [ready] claude\n' +
        "Warning: Not nested under the lead's worktree: Worktree instance identity was unavailable."
    )
  })

  it('adds nothing when the member nested', () => {
    expect(formatGameLaunch({ ...launched, effects: [{ action: 'created_child' }] })).toBe(
      'ORCA-7 (Kael): member ctx_1 [ready] claude'
    )
  })
})
