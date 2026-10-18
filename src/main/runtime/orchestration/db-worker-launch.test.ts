import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './db'

// The launch receipt a real `orca orchestration dispatch --model claude-opus-5-5 --effort high` stored.
const OPUS_HIGH = {
  requested: { agent: 'claude', model: 'claude-opus-5-5', effort: 'high' },
  effective: { agent: 'claude', model: 'claude-opus-5-5', effort: 'high' }
}
const REUSED = {
  requested: { agent: 'claude', model: null, effort: null },
  effective: { agent: 'claude', model: null, effort: null }
}

describe('workerLaunchForTerminal', () => {
  const databases: OrchestrationDb[] = []

  afterEach(() => {
    for (const database of databases) {
      database.close()
    }
    databases.length = 0
  })

  const createDb = () => {
    const database = new OrchestrationDb(':memory:')
    databases.push(database)
    return database
  }

  const dispatch = (db: OrchestrationDb, handle: string, launch: unknown) => {
    const task = db.createTask({ spec: 'work a ticket' })
    const started = db.createStartingWorkerDispatch({
      taskId: task.id,
      startOptions: { topology: 'current', agent: 'claude', launch }
    })
    db.recordWorkerStage({
      dispatchId: started.dispatch.id,
      stage: 'terminal_created',
      terminalHandle: handle
    })
    return started.dispatch.id
  }

  it("reads the model and effort a member's terminal was launched on", () => {
    const db = createDb()
    dispatch(db, 'term_member', OPUS_HIGH)
    expect(db.workerLaunchForTerminal('term_member')).toEqual(OPUS_HIGH.effective)
  })

  it('keeps the launch that chose a model when a later dispatch reused the terminal', () => {
    const db = createDb()
    dispatch(db, 'term_member', OPUS_HIGH)
    dispatch(db, 'term_member', REUSED)
    expect(db.workerLaunchForTerminal('term_member')).toEqual(OPUS_HIGH.effective)
  })

  it('is null for a terminal no dispatch launched, or one launched without a choice', () => {
    const db = createDb()
    dispatch(db, 'term_plain', REUSED)
    dispatch(db, 'term_old', undefined)
    expect(db.workerLaunchForTerminal('term_lead')).toBeNull()
    expect(db.workerLaunchForTerminal('term_plain')).toBeNull()
    expect(db.workerLaunchForTerminal('term_old')).toBeNull()
  })
})
