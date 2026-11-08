import { describe, expect, it } from 'vitest'
import { workerTabTitleOf } from './orchestration-worker-tab-title'

// ORCA-1094 row 6: entering a member, V28's tab reads `Herrero · ORCA-1039 · m1`, not `worker-task_…`.
describe('workerTabTitleOf', () => {
  it("names a game member's tab after its character, ticket and host", () => {
    expect(
      workerTabTitleOf({
        displayName: 'Merlín · ORCA-12 Keep the look',
        taskId: 'task_1',
        host: 'local'
      })
    ).toBe('Merlín · ORCA-12 · local')
    expect(workerTabTitleOf({ displayName: 'Herrero · ORCA-1039 Fix CI', taskId: 'task_1' })).toBe(
      'Herrero · ORCA-1039'
    )
  })

  it('keeps a plain worker title as given, and the task id only when there is none', () => {
    expect(workerTabTitleOf({ displayName: 'Windows release audit', taskId: 'task_1' })).toBe(
      'Windows release audit'
    )
    expect(workerTabTitleOf({ taskId: 'task_1' })).toBe('worker-task_1')
  })
})
