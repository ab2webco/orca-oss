import { describe, expect, it } from 'vitest'
import {
  dispatchBriefLineOf,
  dispatchBriefRelativePathOf,
  parseDispatchBriefLine
} from './orca-dispatch-brief-line'

describe('dispatch brief line', () => {
  it('names the brief inside the worktree, so the member reads it without leaving its cwd', () => {
    expect(dispatchBriefRelativePathOf('ctx_ab12')).toBe('.orca/briefs/ctx_ab12.md')
  })

  it('is one line carrying the path and the task id', () => {
    const line = dispatchBriefLineOf({ dispatchId: 'ctx_ab12', taskId: 'task_9f' })
    expect(line).not.toContain('\n')
    expect(line).toContain('.orca/briefs/ctx_ab12.md')
    expect(line).toContain('task_9f')
  })

  it('parses back what it writes', () => {
    const line = dispatchBriefLineOf({ dispatchId: 'ctx_ab12', taskId: 'task_9f' })
    expect(parseDispatchBriefLine(`  ${line}\n`)).toEqual({
      path: '.orca/briefs/ctx_ab12.md',
      taskId: 'task_9f'
    })
  })

  it('does not take an ordinary prompt for a brief', () => {
    expect(parseDispatchBriefLine('Read the README and fix the build')).toBeNull()
    expect(parseDispatchBriefLine('')).toBeNull()
  })

  it('refuses a dispatch id that is not a plain file name', () => {
    expect(() => dispatchBriefRelativePathOf('../escape')).toThrow()
    expect(() => dispatchBriefRelativePathOf('a/b')).toThrow()
  })
})
