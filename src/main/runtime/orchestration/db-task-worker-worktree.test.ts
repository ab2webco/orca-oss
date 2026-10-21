import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'

describe('OrchestrationDb.latestWorkerWorktreeForTask', () => {
  const databases: OrchestrationDb[] = []
  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.close()
    }
  })

  it("names the worktree a task's newest worker created, so a launch cut short is found", () => {
    const db = new OrchestrationDb(':memory:')
    databases.push(db)
    const task = db.createTask({ spec: 'CIN-12' })
    const other = db.createTask({ spec: 'CIN-13' })
    expect(db.latestWorkerWorktreeForTask(task.id)).toBeNull()

    const first = db.createStartingWorkerDispatch({ taskId: task.id, startOptions: {} })
    db.recordWorkerStage({
      dispatchId: first.dispatch.id,
      stage: 'worktree_created',
      worktreeId: 'repo::/w/cin-12'
    })
    const unrelated = db.createStartingWorkerDispatch({ taskId: other.id, startOptions: {} })
    db.recordWorkerStage({
      dispatchId: unrelated.dispatch.id,
      stage: 'worktree_created',
      worktreeId: 'repo::/w/cin-13'
    })

    expect(db.latestWorkerWorktreeForTask(task.id)).toBe('repo::/w/cin-12')
  })
})
