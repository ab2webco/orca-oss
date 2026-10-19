import { describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'

describe('hasAnyDispatchContexts', () => {
  // Why: a cached false hid the first game member's lead from every agent row until a restart.
  it('turns true when the first supervised worker starts on a fresh database', () => {
    const db = new OrchestrationDb(':memory:')
    try {
      expect(db.hasAnyDispatchContexts()).toBe(false)
      const task = db.createTask({ spec: 'work a ticket' })
      db.createStartingWorkerDispatch({
        taskId: task.id,
        startOptions: { topology: 'current', agent: 'claude', launch: null }
      })
      expect(db.hasAnyDispatchContexts()).toBe(true)
    } finally {
      db.close()
    }
  })
})
